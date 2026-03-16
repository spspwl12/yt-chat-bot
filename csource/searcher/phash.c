/**
 * phash.c ? pHash C 구현
 *
 * DCT 기반 perceptual hash:
 *   1) 64x64 그레이스케일 리사이즈 (bilinear)
 *   2) 정규화 (mean/stddev)
 *   3) 2D DCT (사전 계산 cosine 테이블)
 *   4) DC 제외, MAD dead zone
 *   5) 255-bit 해시 생성
 */
#include "phash.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

 /* ── 전역 테이블 ──────────────── */
static double cos_table[PHASH_DCT_SIZE * PHASH_DCT_SIZE];
static uint8_t popcount_lut[256];
static int initialized = 0;

void phash_init(void) {
    if (initialized) return;

    /* cosine 테이블 */
    for (int i = 0; i < PHASH_DCT_SIZE; i++) {
        for (int j = 0; j < PHASH_DCT_SIZE; j++) {
            cos_table[i * PHASH_DCT_SIZE + j] =
                cos(((2.0 * j + 1.0) * i * M_PI) / (2.0 * PHASH_DCT_SIZE));
        }
    }

    /* popcount LUT */
    for (int i = 0; i < 256; i++) {
        popcount_lut[i] = (uint8_t)(popcount_lut[i >> 1] + (i & 1));
    }

    initialized = 1;
}

/* ── bilinear 리사이즈 (그레이스케일) ── */
static void resize_bilinear(const uint8_t* src, int sw, int sh,
    double* dst, int dw, int dh) {
    double x_ratio = (double)sw / dw;
    double y_ratio = (double)sh / dh;

    for (int dy = 0; dy < dh; dy++) {
        double src_y = dy * y_ratio;
        int y0 = (int)src_y;
        int y1 = y0 + 1 < sh ? y0 + 1 : y0;
        double fy = src_y - y0;

        for (int dx = 0; dx < dw; dx++) {
            double src_x = dx * x_ratio;
            int x0 = (int)src_x;
            int x1 = x0 + 1 < sw ? x0 + 1 : x0;
            double fx = src_x - x0;

            double v = src[y0 * sw + x0] * (1 - fx) * (1 - fy)
                + src[y0 * sw + x1] * fx * (1 - fy)
                + src[y1 * sw + x0] * (1 - fx) * fy
                + src[y1 * sw + x1] * fx * fy;
            dst[dy * dw + dx] = v;
        }
    }
}

/* ── qsort 비교 함수 ── */
static int cmp_double(const void* a, const void* b) {
    double da = *(const double*)a, db = *(const double*)b;
    return (da > db) - (da < db);
}

/* ── 핵심: pHash 계산 ── */
void phash_compute(const uint8_t* gray, int w, int h, uint8_t* out) {
    const int RW = PHASH_RESIZE_W;
    const int RH = PHASH_RESIZE_H;
    const int LF = PHASH_LOW_FREQ;
    const int total = RW * RH;

    /* 1) bilinear 리사이즈 */
    double* resized = (double*)malloc(sizeof(double) * total);
    resize_bilinear(gray, w, h, resized, RW, RH);

    /* 2) 정규화: mean 제거 + stddev 나누기 */
    double mean = 0;
    for (int i = 0; i < total; i++) mean += resized[i];
    mean /= total;

    double var = 0;
    for (int i = 0; i < total; i++) {
        double d = resized[i] - mean;
        var += d * d;
    }
    double stddev = sqrt(var / total);
    if (stddev < 1e-10) stddev = 1.0;

    for (int i = 0; i < total; i++) {
        resized[i] = (resized[i] - mean) / stddev;
    }

    /* 3) 2D DCT (행 → 열) */
    double* row_dct = (double*)calloc(RH * PHASH_DCT_SIZE, sizeof(double));

    for (int y = 0; y < RH; y++) {
        for (int u = 0; u < LF; u++) {
            double sum = 0;
            for (int x = 0; x < RW; x++) {
                sum += resized[y * RW + x] * cos_table[u * PHASH_DCT_SIZE + x];
            }
            row_dct[y * PHASH_DCT_SIZE + u] = sum;
        }
    }

    double dct_matrix[PHASH_LOW_FREQ * PHASH_LOW_FREQ];
    for (int u = 0; u < LF; u++) {
        for (int v = 0; v < LF; v++) {
            double sum = 0;
            for (int y = 0; y < RH; y++) {
                sum += row_dct[y * PHASH_DCT_SIZE + u] * cos_table[v * PHASH_DCT_SIZE + y];
            }
            dct_matrix[v * LF + u] = sum;
        }
    }

    free(row_dct);
    free(resized);

    /* 4) AC 성분 추출 (DC 제외) */
    double ac[PHASH_AC_COUNT];
    for (int i = 0; i < PHASH_AC_COUNT; i++) {
        ac[i] = dct_matrix[i + 1];
    }

    /* 중앙값 */
    double sorted[PHASH_AC_COUNT];
    memcpy(sorted, ac, sizeof(sorted));
    qsort(sorted, PHASH_AC_COUNT, sizeof(double), cmp_double);
    double median = sorted[PHASH_AC_COUNT / 2];

    /* MAD 기반 dead zone */
    double abs_dev[PHASH_AC_COUNT];
    for (int i = 0; i < PHASH_AC_COUNT; i++) {
        abs_dev[i] = fabs(sorted[i] - median);
    }
    qsort(abs_dev, PHASH_AC_COUNT, sizeof(double), cmp_double);
    double mad = abs_dev[PHASH_AC_COUNT / 2];
    double dead_zone = mad * 0.5;

    /* 5) 해시 생성 */
    memset(out, 0, PHASH_HASH_BYTES);
    for (int i = 0; i < PHASH_AC_COUNT; i++) {
        if (ac[i] > median + dead_zone) {
            out[i / 8] |= (1 << (7 - (i % 8)));
        }
    }
}

/* ── 파일에서 pHash 계산 ── */
int phash_compute_file(const char* filepath, uint8_t* out) {
    int w, h, channels;
    uint8_t* img = stbi_load(filepath, &w, &h, &channels, 1); /* 그레이스케일 강제 */
    if (!img) return -1;

    phash_compute(img, w, h, out);
    stbi_image_free(img);
    return 0;
}

/* ── Hamming Distance ── */
int phash_hamming(const uint8_t* a, const uint8_t* b) {
    int dist = 0;
    for (int i = 0; i < PHASH_HASH_BYTES; i++) {
        dist += popcount_lut[a[i] ^ b[i]];
    }
    return dist;
}

/* ── hex 변환 유틸 ── */
static int hex_char(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

int hex_to_bytes(const char* hex, uint8_t* out, int maxlen) {
    int len = 0;
    while (*hex && *(hex + 1) && len < maxlen) {
        int hi = hex_char(*hex++);
        int lo = hex_char(*hex++);
        if (hi < 0 || lo < 0) break;
        out[len++] = (uint8_t)((hi << 4) | lo);
    }
    return len;
}

void bytes_to_hex(const uint8_t* data, int len, char* out) {
    static const char hx[] = "0123456789abcdef";
    for (int i = 0; i < len; i++) {
        out[i * 2] = hx[data[i] >> 4];
        out[i * 2 + 1] = hx[data[i] & 0xf];
    }
    out[len * 2] = '\0';
}
