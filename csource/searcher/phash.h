#ifndef PHASH_H
#define PHASH_H

#include <stdint.h>

/* ── 설정 ─────────────────────── */
#define PHASH_RESIZE_W    64
#define PHASH_RESIZE_H    64
#define PHASH_DCT_SIZE    64
#define PHASH_LOW_FREQ    16
#define PHASH_AC_COUNT    (PHASH_LOW_FREQ * PHASH_LOW_FREQ - 1)  /* 255 */
#define PHASH_HASH_BYTES  ((PHASH_AC_COUNT + 7) / 8)             /* 32 */

/* ── API ──────────────────────── */

/**
 * 초기화: cosine 테이블 + popcount LUT 사전 계산
 * main() 시작 직후 반드시 1회 호출
 */
void phash_init(void);

/**
 * 그레이스케일 이미지 버퍼에서 pHash 계산
 * @param gray    폭×높이 그레이스케일 픽셀 (0~255)
 * @param w       원본 이미지 폭
 * @param h       원본 이미지 높이
 * @param out     결과 해시 (PHASH_HASH_BYTES 바이트)
 */
void phash_compute(const uint8_t *gray, int w, int h, uint8_t *out);

/**
 * 이미지 파일(PNG 등)에서 pHash 계산 (내부에서 stb_image 로드)
 * @param filepath  이미지 파일 경로
 * @param out       결과 해시 (PHASH_HASH_BYTES 바이트)
 * @return 0=성공, -1=실패
 */
int phash_compute_file(const char *filepath, uint8_t *out);

/**
 * 두 해시 간의 Hamming Distance (popcount 사용)
 */
int phash_hamming(const uint8_t *a, const uint8_t *b);

/**
 * hex 문자열 → 바이트 배열
 * @param hex     hex 문자열 (null-terminated)
 * @param out     출력 버퍼
 * @param maxlen  출력 버퍼 최대 바이트 수
 * @return 변환된 바이트 수
 */
int hex_to_bytes(const char *hex, uint8_t *out, int maxlen);

/**
 * 바이트 배열 → hex 문자열
 */
void bytes_to_hex(const uint8_t *data, int len, char *out);

#endif /* PHASH_H */
