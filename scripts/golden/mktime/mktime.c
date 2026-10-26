#include <stdio.h>
#include <stdlib.h>
#include <time.h>
/* usage: mk Y M D h m s isdst [Y M D h m s isdst ...]  (each call shares glibc's cache) */
int main(int argc, char **argv) {
  for (int i = 1; i + 6 < argc; i += 7) {
    struct tm tm = {0};
    tm.tm_year = atoi(argv[i]) - 1900; tm.tm_mon = atoi(argv[i+1]) - 1; tm.tm_mday = atoi(argv[i+2]);
    tm.tm_hour = atoi(argv[i+3]); tm.tm_min = atoi(argv[i+4]); tm.tm_sec = atoi(argv[i+5]); tm.tm_isdst = atoi(argv[i+6]);
    time_t t = mktime(&tm);
    printf("%ld %04d-%02d-%02d %02d:%02d:%02d isdst=%d\n", (long)t, tm.tm_year+1900, tm.tm_mon+1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec, tm.tm_isdst);
  }
  return 0;
}
