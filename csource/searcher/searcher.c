/**
 * searcher.c — 순수 C 영상 지문 검색기
 *
 * Node.js indexer가 생성한 JSON fingerprint DB를 읽고,
 * FFmpeg CLI로 클립 프레임을 추출한 뒤 초고속 검색.
 *
 * 데몬 모드 (--daemon):
 *   DB를 1회 로드 후 stdin으로 클립 경로를 받아 반복 검색.
 *   결과는 stdout JSON + __RESULT_END__ 구분자로 출력.
 *   Node.js에서 spawn하여 상시 구동.
 *
 * 스레딩:
 *   MSVC  → _beginthreadex + WaitForMultipleObjects
 *   GCC   → pthread_create  + pthread_join (Linux + MinGW-w64)
 *
 * 컴파일:
 *   cl /O2 /W3 searcher.c phash.c /Fe:searcher.exe
 *   gcc -O3 -o searcher searcher.c phash.c -lm -lpthread
 *
 * 사용법:
 *   searcher.exe <clip_file> [db_path] [threshold] [config_path] [threads]
 *   searcher.exe --daemon [db_path] [threshold] [config_path] [threads]
 */

#define _CRT_SECURE_NO_WARNINGS

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "phash.h"

/* ─── 플랫폼 감지 ─── */
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <direct.h>
#define PLATFORM_MKDIR(d) _mkdir(d)
#else
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#define PLATFORM_MKDIR(d) mkdir(d, 0755)
#endif

/* ─── 스레딩 추상화 ─── */
#ifdef _MSC_VER
/* ── MSVC: Win32 스레드 ── */
#include <process.h>
#include <windows.h>

typedef HANDLE thread_t;
typedef unsigned(__stdcall *thread_func_t)(void *);

static int thread_create(thread_t *t, thread_func_t fn, void *arg) {
    *t = (HANDLE)_beginthreadex(NULL, 0, fn, arg, 0, NULL);
    return (*t == 0) ? -1 : 0;
}
static void thread_join(thread_t t) {
    WaitForSingleObject(t, INFINITE);
    CloseHandle(t);
}
static int get_cpu_count(void) {
    SYSTEM_INFO si;
    GetSystemInfo(&si);
    return (int)si.dwNumberOfProcessors;
}
#define THREAD_RETURN unsigned __stdcall
#define THREAD_RET return 0

#else
/* ── GCC/Clang: POSIX 스레드 (Linux + MinGW-w64 winpthreads) ── */
#include <pthread.h>

typedef pthread_t thread_t;
typedef void *(*thread_func_t)(void *);

static int thread_create(thread_t *t, thread_func_t fn, void *arg) {
    return pthread_create(t, NULL, fn, arg);
}
static void thread_join(thread_t t) { pthread_join(t, NULL); }

#ifdef _WIN32
/* MinGW on Windows: get CPU count via Windows API */
#include <windows.h>
static int get_cpu_count(void) {
    SYSTEM_INFO si;
    GetSystemInfo(&si);
    return (int)si.dwNumberOfProcessors;
}
#else
static int get_cpu_count(void) {
    long n = sysconf(_SC_NPROCESSORS_ONLN);
    return n > 0 ? (int)n : 1;
}
#endif

#define THREAD_RETURN void *
#define THREAD_RET return NULL

#endif

/* ─── 뮤텍스 추상화 ─── */
#ifdef _MSC_VER
typedef CRITICAL_SECTION mutex_t;
static void mutex_init(mutex_t *m) { InitializeCriticalSection(m); }
static void mutex_lock(mutex_t *m) { EnterCriticalSection(m); }
static void mutex_unlock(mutex_t *m) { LeaveCriticalSection(m); }
static void mutex_destroy(mutex_t *m) { DeleteCriticalSection(m); }
#else
typedef pthread_mutex_t mutex_t;
static void mutex_init(mutex_t *m) { pthread_mutex_init(m, NULL); }
static void mutex_lock(mutex_t *m) { pthread_mutex_lock(m); }
static void mutex_unlock(mutex_t *m) { pthread_mutex_unlock(m); }
static void mutex_destroy(mutex_t *m) { pthread_mutex_destroy(m); }
#endif

/* ─── 설정 ─────────────────────── */
#define MAX_VIDEOS 1000
#define MAX_CLIP_FRAMES 100
#define MAX_PATH_LEN 1024
#define MAX_THREADS 64
#define DEFAULT_THRESHOLD 30
#define DEFAULT_TOP_N 5
#define OUTPUT_JSON 1

#ifdef OUTPUT_JSON
#define LOG(...) ((void)0)
#else
#define LOG(...) printf(__VA_ARGS__)
#endif

/* ─── 구조체 ───────────────────── */
typedef struct {
    double timestamp;
    uint8_t hash[PHASH_HASH_BYTES];
} FrameHash;

typedef struct {
    char filename[MAX_PATH_LEN];
    char filepath[MAX_PATH_LEN];
    double duration;
    int hash_count;
    FrameHash *hashes;
} VideoEntry;

typedef struct {
    int video_count;
    VideoEntry *videos;
} FingerprintDB;

typedef struct {
    int video_index;
    int best_distance;
    double best_timestamp;
    int best_clip_frame_idx;
    int match_count;
} MatchResult;

typedef struct {
    FingerprintDB *db;
    uint8_t (*clip_hashes)[PHASH_HASH_BYTES];
    int clip_hash_count;
    int threshold;
    int vid_start;
    int vid_end;
    MatchResult *results;
    int result_count;
} WorkerCtx;

/* ─── JSON 파싱 ─── */

static const char *skip_ws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')
        p++;
    return p;
}

static const char *skip_string(const char *p) {
    if (*p != '"')
        return p;
    p++;
    while (*p && *p != '"') {
        if (*p == '\\')
            p++;
        p++;
    }
    if (*p == '"')
        p++;
    return p;
}

static const char *skip_value(const char *p) {
    p = skip_ws(p);
    if (*p == '"') {
        return skip_string(p);
    } else if (*p == '{') {
        p++;
        int depth = 1;
        while (*p && depth > 0) {
            if (*p == '"') {
                p = skip_string(p);
                continue;
            }
            if (*p == '{')
                depth++;
            else if (*p == '}')
                depth--;
            if (depth > 0)
                p++;
        }
        if (*p == '}')
            p++;
        return p;
    } else if (*p == '[') {
        p++;
        int depth = 1;
        while (*p && depth > 0) {
            if (*p == '"') {
                p = skip_string(p);
                continue;
            }
            if (*p == '[')
                depth++;
            else if (*p == ']')
                depth--;
            if (depth > 0)
                p++;
        }
        if (*p == ']')
            p++;
        return p;
    } else {
        while (*p && *p != ',' && *p != '}' && *p != ']' && *p != ' ' && *p != '\t' && *p != '\n' &&
               *p != '\r')
            p++;
        return p;
    }
}

static const char *parse_string_val(const char *p, char *out, int maxlen) {
    p = skip_ws(p);
    if (*p != '"') {
        out[0] = '\0';
        return p;
    }
    p++;
    int i = 0;
    while (*p && *p != '"' && i < maxlen - 1) {
        if (*p == '\\' && *(p + 1)) {
            p++;
        }
        out[i++] = *p++;
    }
    out[i] = '\0';
    if (*p == '"')
        p++;
    return p;
}

static const char *parse_number_val(const char *p, double *out) {
    p = skip_ws(p);
    char *end;
    *out = strtod(p, &end);
    return end;
}

static const char *find_key_value(const char *p, const char *key, const char **next) {
    int klen = (int)strlen(key);
    p = skip_ws(p);

    while (*p && *p != '}') {
        if (*p == ',') {
            p++;
            p = skip_ws(p);
            continue;
        }
        if (*p != '"')
            break;
        const char *key_start = p + 1;
        p = skip_string(p);
        int key_len = (int)(p - key_start - 1);

        p = skip_ws(p);
        if (*p == ':')
            p++;
        p = skip_ws(p);

        if (key_len == klen && strncmp(key_start, key, klen) == 0) {
            const char *val_start = p;
            if (next)
                *next = skip_value(p);
            return val_start;
        }

        p = skip_value(p);
        p = skip_ws(p);
    }

    return NULL;
}

/* ─── DB 파싱 ─── */
static int parse_db(const char *json, FingerprintDB *db) {
    db->video_count = 0;
    db->videos = (VideoEntry *)calloc(MAX_VIDEOS, sizeof(VideoEntry));

    const char *p = skip_ws(json);
    if (*p == '{')
        p++;
    const char *videos_val = find_key_value(p, "videos", NULL);
    if (!videos_val || *videos_val != '[') {
        fprintf(stderr, "ERROR: 'videos' 배열을 찾을 수 없습니다\n");
        return -1;
    }
    p = videos_val + 1;

    while (*p) {
        p = skip_ws(p);
        if (*p == ']')
            break;
        if (*p == ',') {
            p++;
            continue;
        }
        if (*p != '{')
            break;
        if (db->video_count >= MAX_VIDEOS)
            break;

        const char *obj_end = skip_value(p);
        const char *inner = p + 1;
        VideoEntry *v = &db->videos[db->video_count];
        const char *unused;

        const char *val = find_key_value(inner, "filename", &unused);
        if (val)
            parse_string_val(val, v->filename, MAX_PATH_LEN);

        val = find_key_value(inner, "filepath", &unused);
        if (val)
            parse_string_val(val, v->filepath, MAX_PATH_LEN);

        val = find_key_value(inner, "duration", &unused);
        if (val)
            parse_number_val(val, &v->duration);

        double fc = 0;
        val = find_key_value(inner, "frameCount", &unused);
        if (val)
            parse_number_val(val, &fc);

        v->hash_count = 0;
        v->hashes = (FrameHash *)calloc((int)fc + 100, sizeof(FrameHash));

        val = find_key_value(inner, "hashes", &unused);
        if (val && *val == '[') {
            const char *hp = val + 1;

            while (*hp) {
                hp = skip_ws(hp);
                if (*hp == ']')
                    break;
                if (*hp == ',') {
                    hp++;
                    continue;
                }
                if (*hp != '{')
                    break;

                FrameHash *fh = &v->hashes[v->hash_count];
                const char *hi = hp + 1;

                const char *hv;
                hv = find_key_value(hi, "timestamp", &unused);
                if (hv)
                    parse_number_val(hv, &fh->timestamp);

                hv = find_key_value(hi, "hash", &unused);
                if (hv) {
                    char hex_str[256];
                    parse_string_val(hv, hex_str, sizeof(hex_str));
                    hex_to_bytes(hex_str, fh->hash, PHASH_HASH_BYTES);
                }

                v->hash_count++;
                hp = skip_value(hp);
                hp = skip_ws(hp);
            }
        }

        db->video_count++;
        p = obj_end;
    }

    return 0;
}

/* ─── FFmpeg 프레임 추출 ─── */

typedef struct {
    char ffmpeg_path[MAX_PATH_LEN];
    int fps;
    int scale_w;
    int scale_h;
    int crop_enabled;
    int crop_x, crop_y, crop_w, crop_h;
} ExtractConfig;

static void load_extract_config(const char *config_path, ExtractConfig *ec) {
    strcpy(ec->ffmpeg_path, "ffmpeg");
    ec->fps = 2;
    ec->scale_w = 320;
    ec->scale_h = 240;
    ec->crop_enabled = 0;
    ec->crop_x = ec->crop_y = ec->crop_w = ec->crop_h = 0;

    FILE *f = fopen(config_path, "rb");
    if (!f)
        return;

    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = (char *)malloc(sz + 1);
    fread(buf, 1, sz, f);
    buf[sz] = '\0';
    fclose(f);

    const char *root = skip_ws(buf);
    if (*root == '{')
        root++;
    const char *unused;

    const char *ffmpeg_obj = find_key_value(root, "ffmpeg", &unused);
    if (ffmpeg_obj && *ffmpeg_obj == '{') {
        const char *fp = find_key_value(ffmpeg_obj + 1, "ffmpegPath", &unused);
        if (fp && *fp == '"') {
            char tmp[MAX_PATH_LEN];
            parse_string_val(fp, tmp, MAX_PATH_LEN);
            if (tmp[0])
                strcpy(ec->ffmpeg_path, tmp);
        }
    }

    const char *ext_obj = find_key_value(root, "extraction", &unused);
    if (ext_obj && *ext_obj == '{') {
        const char *inner = ext_obj + 1;
        const char *v;
        double d;

        v = find_key_value(inner, "fps", &unused);
        if (v) {
            parse_number_val(v, &d);
            ec->fps = (int)d;
        }
        v = find_key_value(inner, "width", &unused);
        if (v) {
            parse_number_val(v, &d);
            ec->scale_w = (int)d;
        }
        v = find_key_value(inner, "height", &unused);
        if (v) {
            parse_number_val(v, &d);
            ec->scale_h = (int)d;
        }

        const char *crop_obj = find_key_value(inner, "crop", &unused);
        if (crop_obj && *crop_obj == '{') {
            const char *ci = crop_obj + 1;
            v = find_key_value(ci, "enabled", &unused);
            if (v) {
                v = skip_ws(v);
                ec->crop_enabled = (strncmp(v, "true", 4) == 0) ? 1 : 0;
            }
            v = find_key_value(ci, "x", &unused);
            if (v) { parse_number_val(v, &d); ec->crop_x = (int)d; }
            v = find_key_value(ci, "y", &unused);
            if (v) { parse_number_val(v, &d); ec->crop_y = (int)d; }
            v = find_key_value(ci, "w", &unused);
            if (v) { parse_number_val(v, &d); ec->crop_w = (int)d; }
            v = find_key_value(ci, "h", &unused);
            if (v) { parse_number_val(v, &d); ec->crop_h = (int)d; }
        }
    }

    free(buf);
}

static void build_vf_string(const ExtractConfig *ec, char *vf, int vflen) {
    vf[0] = '\0';
    int pos = 0;
    if (ec->crop_enabled && ec->crop_w > 0 && ec->crop_h > 0) {
        pos += snprintf(vf + pos, vflen - pos, "crop=%d:%d:%d:%d,", ec->crop_w, ec->crop_h,
                        ec->crop_x, ec->crop_y);
    }
    pos += snprintf(vf + pos, vflen - pos, "fps=%d,", ec->fps);
    pos += snprintf(vf + pos, vflen - pos, "scale=%d:%d", ec->scale_w, ec->scale_h);
}

static int extract_clip_frames(const ExtractConfig *ec, const char *clip_path, const char *temp_dir,
                               char frames[][MAX_PATH_LEN], int max_frames, char *error_msg,
                               int error_msg_len) {
    if (error_msg)
        error_msg[0] = '\0';
    PLATFORM_MKDIR(temp_dir);

    char vf[512];
    build_vf_string(ec, vf, sizeof(vf));

    char output_pattern[MAX_PATH_LEN];
    snprintf(output_pattern, sizeof(output_pattern), "%s/frame_%%06d.png", temp_dir);

    char err_file[MAX_PATH_LEN];
    snprintf(err_file, sizeof(err_file), "%s/ffmpeg_err.log", temp_dir);

    char cmd[MAX_PATH_LEN * 4];

#ifdef _WIN32
#ifdef OUTPUT_JSON
    snprintf(cmd, sizeof(cmd), "\"\"%s\" -y -i \"%s\" -vf %s -f image2 \"%s\" 2>\"%s\"\"",
             ec->ffmpeg_path, clip_path, vf, output_pattern, err_file);
#else
    snprintf(cmd, sizeof(cmd), "\"\"%s\" -y -i \"%s\" -vf %s -f image2 \"%s\"\"", ec->ffmpeg_path,
             clip_path, vf, output_pattern);
#endif
#else
#ifdef OUTPUT_JSON
    snprintf(cmd, sizeof(cmd), "\"%s\" -y -i \"%s\" -vf %s -f image2 \"%s\" 2>\"%s\"",
             ec->ffmpeg_path, clip_path, vf, output_pattern, err_file);
#else
    snprintf(cmd, sizeof(cmd), "\"%s\" -y -i \"%s\" -vf %s -f image2 \"%s\"", ec->ffmpeg_path,
             clip_path, vf, output_pattern);
#endif
#endif

    LOG("      CMD: %s\n", cmd);
    fflush(stdout);

    int ret = system(cmd);

#ifndef OUTPUT_JSON
    if (ret != 0) {
        printf("      WARNING: ffmpeg 종료 코드 %d\n", ret);
    }
#endif

    int count = 0;
    for (int i = 1; i <= max_frames; i++) {
        char path[MAX_PATH_LEN];
        snprintf(path, sizeof(path), "%s/frame_%06d.png", temp_dir, i);
        FILE *f = fopen(path, "rb");
        if (!f)
            break;
        fclose(f);
        strncpy(frames[count], path, MAX_PATH_LEN);
        count++;
    }

    if (count == 0 && ret != 0 && error_msg) {
        FILE *ef = fopen(err_file, "r");
        if (ef) {
            int len = (int)fread(error_msg, 1, error_msg_len - 1, ef);
            error_msg[len] = '\0';
            fclose(ef);
            for (int i = 0; i < len; i++) {
                if (error_msg[i] == '\r') error_msg[i] = ' ';
                if (error_msg[i] == '\n') error_msg[i] = ' ';
            }
        } else {
            snprintf(error_msg, error_msg_len, "ffmpeg exit code %d, path: %s", ret,
                     ec->ffmpeg_path);
        }
    }

    remove(err_file);
    return count;
}

static void cleanup_temp(const char *temp_dir) {
#ifdef _WIN32
    char cmd[MAX_PATH_LEN + 32];
    snprintf(cmd, sizeof(cmd), "rmdir /s /q \"%s\" 2>nul", temp_dir);
    system(cmd);
#else
    char cmd[MAX_PATH_LEN + 32];
    snprintf(cmd, sizeof(cmd), "rm -rf \"%s\" 2>/dev/null", temp_dir);
    system(cmd);
#endif
}

/* ─── 검색 워커 스레드 함수 ─── */
static THREAD_RETURN search_worker(void *arg) {
    WorkerCtx *ctx = (WorkerCtx *)arg;
    ctx->result_count = 0;

    for (int vi = ctx->vid_start; vi < ctx->vid_end; vi++) {
        VideoEntry *v = &ctx->db->videos[vi];
        int best_dist = 256;
        double best_ts = 0;
        int best_clip_fidx = 0;
        int match_cnt = 0;

        for (int ci = 0; ci < ctx->clip_hash_count; ci++) {
            const uint8_t *clip_h = ctx->clip_hashes[ci];

            for (int di = 0; di < v->hash_count; di++) {
                int dist = phash_hamming(clip_h, v->hashes[di].hash);

                if (dist <= ctx->threshold) {
                    match_cnt++;
                    if (dist < best_dist) {
                        best_dist = dist;
                        best_ts = v->hashes[di].timestamp;
                        best_clip_fidx = ci;
                    }
                }
            }
        }

        if (match_cnt > 0) {
            MatchResult *r = &ctx->results[ctx->result_count++];
            r->video_index = vi;
            r->best_distance = best_dist;
            r->best_timestamp = best_ts;
            r->best_clip_frame_idx = best_clip_fidx;
            r->match_count = match_cnt;
        }
    }

    THREAD_RET;
}

/* ─── 유틸리티 ─── */
static void format_time(double seconds, char *buf, int buflen) {
    int h = (int)(seconds / 3600);
    int m = (int)(fmod(seconds, 3600) / 60);
    int s = (int)fmod(seconds, 60);
    if (h > 0)
        snprintf(buf, buflen, "%d:%02d:%02d", h, m, s);
    else
        snprintf(buf, buflen, "%d:%02d", m, s);
}

static int cmp_results(const void *a, const void *b) {
    const MatchResult *ma = (const MatchResult *)a;
    const MatchResult *mb = (const MatchResult *)b;
    if (mb->match_count != ma->match_count)
        return mb->match_count - ma->match_count;
    return ma->best_distance - mb->best_distance;
}

static void print_json_escaped(const char *s) {
    putchar('"');
    while (*s) {
        switch (*s) {
        case '"':  printf("\\\""); break;
        case '\\': printf("\\\\"); break;
        case '\n': printf("\\n");  break;
        case '\r': printf("\\r");  break;
        case '\t': printf("\\t");  break;
        default:   putchar(*s);    break;
        }
        s++;
    }
    putchar('"');
}

/* ─── 단일 클립 검색 실행 ─── */
static int do_clip_search(FingerprintDB *db, ExtractConfig *ec, const char *clip_path,
                          int threshold, int num_threads, int total_hashes, int search_id) {
    /* 고유 임시 디렉토리 */
    char temp_dir[64];
    snprintf(temp_dir, sizeof(temp_dir), "csearch_temp_%d", search_id);

    /* 프레임 추출 */
    char clip_frames[MAX_CLIP_FRAMES][MAX_PATH_LEN];
    char ffmpeg_error[2048];
    int frame_count = extract_clip_frames(ec, clip_path, temp_dir, clip_frames, MAX_CLIP_FRAMES,
                                          ffmpeg_error, sizeof(ffmpeg_error));
    if (frame_count == 0) {
        cleanup_temp(temp_dir);
        printf("{\"error\":\"extraction_failed\",\"message\":");
        print_json_escaped(ffmpeg_error[0] ? ffmpeg_error : "No frames extracted from clip");
        printf("}\n");
        return 1;
    }

    /* 클립 해시 계산 */
    uint8_t clip_hashes[MAX_CLIP_FRAMES][PHASH_HASH_BYTES];
    int clip_hash_count = 0;
    for (int i = 0; i < frame_count; i++) {
        if (phash_compute_file(clip_frames[i], clip_hashes[clip_hash_count]) == 0)
            clip_hash_count++;
    }
    cleanup_temp(temp_dir);

    if (clip_hash_count == 0) {
        printf("{\"error\":\"hash_failed\",\"message\":\"Failed to compute clip hashes\"}\n");
        return 1;
    }

    /* 스레드 수 조정 */
    int nt = num_threads;
    if (nt > db->video_count)
        nt = db->video_count;

    /* 멀티스레드 검색 */
    clock_t search_start = clock();
    thread_t threads[MAX_THREADS];
    WorkerCtx contexts[MAX_THREADS];
    int vids_per_thread = db->video_count / nt;
    int remainder = db->video_count % nt;

    int vid_offset = 0;
    for (int t = 0; t < nt; t++) {
        int count = vids_per_thread + (t < remainder ? 1 : 0);
        contexts[t].db = db;
        contexts[t].clip_hashes = clip_hashes;
        contexts[t].clip_hash_count = clip_hash_count;
        contexts[t].threshold = threshold;
        contexts[t].vid_start = vid_offset;
        contexts[t].vid_end = vid_offset + count;
        contexts[t].results = (MatchResult *)calloc(count, sizeof(MatchResult));
        contexts[t].result_count = 0;
        thread_create(&threads[t], (thread_func_t)search_worker, &contexts[t]);
        vid_offset += count;
    }

    for (int t = 0; t < nt; t++)
        thread_join(threads[t]);

    double search_time = (double)(clock() - search_start) / CLOCKS_PER_SEC;
    long long total_cmp = (long long)clip_hash_count * total_hashes;
    double speed = search_time > 0 ? total_cmp / search_time / 1000000.0 : 0;

    /* 결과 수집 */
    int total_results = 0;
    for (int t = 0; t < nt; t++)
        total_results += contexts[t].result_count;

    MatchResult *all_results = (MatchResult *)malloc(
        (total_results > 0 ? total_results : 1) * sizeof(MatchResult));
    int idx = 0;
    for (int t = 0; t < nt; t++) {
        memcpy(&all_results[idx], contexts[t].results,
               contexts[t].result_count * sizeof(MatchResult));
        idx += contexts[t].result_count;
        free(contexts[t].results);
    }

    qsort(all_results, total_results, sizeof(MatchResult), cmp_results);

    /* JSON 출력 */
    int show = total_results < DEFAULT_TOP_N ? total_results : DEFAULT_TOP_N;

    printf("{\n");
    printf("  \"error\": null,\n");
    printf("  \"searchTime\": %.3f,\n", search_time);
    printf("  \"totalComparisons\": %lld,\n", total_cmp);
    printf("  \"speed\": %.1f,\n", speed);
    printf("  \"threshold\": %d,\n", threshold);
    printf("  \"clipFrames\": %d,\n", clip_hash_count);
    printf("  \"totalMatches\": %d,\n", total_results);
    printf("  \"matches\": [\n");

    for (int i = 0; i < show; i++) {
        MatchResult *m = &all_results[i];
        VideoEntry *v = &db->videos[m->video_index];
        double sim = (1.0 - (double)m->best_distance / PHASH_AC_COUNT) * 100.0;
        double cov = (double)m->match_count / clip_hash_count * 100.0;
        double clip_ts = (double)m->best_clip_frame_idx / ec->fps;

        printf("    {\n");
        printf("      \"rank\": %d,\n", i + 1);
        printf("      \"filename\": ");
        print_json_escaped(v->filename);
        printf(",\n");
        printf("      \"filepath\": ");
        print_json_escaped(v->filepath);
        printf(",\n");
        printf("      \"similarity\": %.2f,\n", sim);
        printf("      \"hammingDistance\": %d,\n", m->best_distance);
        printf("      \"matchCount\": %d,\n", m->match_count);
        printf("      \"coverage\": %.1f,\n", cov);
        printf("      \"dbTimestamp\": %.2f,\n", m->best_timestamp);
        printf("      \"clipTimestamp\": %.2f,\n", clip_ts);
        printf("      \"clipFrameIndex\": %d\n", m->best_clip_frame_idx);
        printf("    }%s\n", (i < show - 1) ? "," : "");
    }

    printf("  ]\n");
    printf("}\n");

    free(all_results);
    return 0;
}

/* ═══════════════════ MAIN ═══════════════════ */
int main(int argc, char *argv[]) {
    if (argc < 2) {
        printf("사용법: %s <clip|--daemon> [db_path] [threshold] [config_path] [threads]\n", argv[0]);
        printf("  --daemon:    DB 1회 로드 후 stdin으로 클립 경로를 받아 반복 검색\n");
        printf("  db_path:     fingerprints.json (기본: ../data/fingerprints.json)\n");
        printf("  threshold:   Hamming 임계값 (기본: %d)\n", DEFAULT_THRESHOLD);
        printf("  config_path: config.json 경로 (기본: ../config.json)\n");
        printf("  threads:     스레드 수 (기본: CPU 코어 수)\n");
#ifdef OUTPUT_JSON
        printf("{\"error\":\"usage\",\"message\":\"no clip file specified\"}\n");
#endif
        return 1;
    }

    int daemon_mode = (strcmp(argv[1], "--daemon") == 0);
    const char *clip_path = daemon_mode ? NULL : argv[1];
    const char *db_path = argc > 2 ? argv[2] : "../data/fingerprints.json";
    int threshold = argc > 3 ? atoi(argv[3]) : DEFAULT_THRESHOLD;
    const char *config_path = argc > 4 ? argv[4] : "../config.json";
    int num_threads = argc > 5 ? atoi(argv[5]) : get_cpu_count();

    if (num_threads < 1)
        num_threads = 1;
    if (num_threads > MAX_THREADS)
        num_threads = MAX_THREADS;

    phash_init();

    /* config 로드 */
    ExtractConfig ec;
    load_extract_config(config_path, &ec);
    LOG("\n설정: fps=%d, scale=%dx%d, crop=%s, ffmpeg=%s\n", ec.fps, ec.scale_w, ec.scale_h,
        ec.crop_enabled ? "ON" : "OFF", ec.ffmpeg_path);

    /* DB 로드 */
    LOG("\n[1/4] DB 로드 중: %s\n", db_path);
    clock_t t0 = clock();

    FILE *dbf = fopen(db_path, "rb");
    if (!dbf) {
        printf("{\"error\":\"db_not_found\",\"message\":\"DB file not found: %s\"}\n", db_path);
        return 1;
    }
    fseek(dbf, 0, SEEK_END);
    long dbsize = ftell(dbf);
    fseek(dbf, 0, SEEK_SET);
    char *json = (char *)malloc(dbsize + 1);
    fread(json, 1, dbsize, dbf);
    json[dbsize] = '\0';
    fclose(dbf);

    FingerprintDB db;
    if (parse_db(json, &db) != 0) {
        free(json);
        printf("{\"error\":\"db_parse_failed\",\"message\":\"Failed to parse DB\"}\n");
        return 1;
    }
    free(json);

    int total_hashes = 0;
    for (int i = 0; i < db.video_count; i++)
        total_hashes += db.videos[i].hash_count;
    double load_time = (double)(clock() - t0) / CLOCKS_PER_SEC;
    LOG("      %d개 영상, %d개 해시 (%.2fs)\n", db.video_count, total_hashes, load_time);

    if (daemon_mode) {
        /* ═══ 데몬 모드: stdin에서 클립 경로를 받아 반복 검색 ═══ */
        fprintf(stderr, "__DAEMON_READY__\n");
        fflush(stderr);

        char stdin_buf[MAX_PATH_LEN];
        int search_counter = 0;

        while (fgets(stdin_buf, sizeof(stdin_buf), stdin)) {
            /* 줄바꿈 제거 */
            stdin_buf[strcspn(stdin_buf, "\r\n")] = '\0';
            if (stdin_buf[0] == '\0')
                continue;

            /* 종료 명령 */
            if (strcmp(stdin_buf, "quit") == 0 || strcmp(stdin_buf, "exit") == 0)
                break;

            do_clip_search(&db, &ec, stdin_buf, threshold, num_threads,
                           total_hashes, search_counter++);

            printf("__RESULT_END__\n");
            fflush(stdout);
        }

        fprintf(stderr, "__DAEMON_EXIT__\n");
        fflush(stderr);

    } else {
        /* ═══ 일반 모드: 단일 클립 검색 ═══ */
        do_clip_search(&db, &ec, clip_path, threshold, num_threads, total_hashes, 0);
    }

    /* DB 정리 */
    for (int i = 0; i < db.video_count; i++)
        free(db.videos[i].hashes);
    free(db.videos);

    return 0;
}
