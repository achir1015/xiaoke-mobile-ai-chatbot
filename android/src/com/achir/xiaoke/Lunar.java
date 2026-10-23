package com.achir.xiaoke;

import java.util.Calendar;
import java.util.Date;
import java.util.TimeZone;

/** 農曆日期（離線計算，2000–2099）。表格與算法同 LX04 版 Almanac.java。 */
final class Lunar {
    private static final String[] STEM = {"甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"};
    private static final String[] BRANCH = {"子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"};
    private static final String[] ZODIAC = {"鼠", "牛", "虎", "兔", "龍", "蛇", "馬", "羊", "猴", "雞", "狗", "豬"};
    private static final int FIRST_YEAR = 2000;
    // { 正月初一距 2000-01-01 的天數, 各月大小 bit(i)=第 i 月(1=30天), 閏幾月(0=無) }
    private static final int[] L_CNY = {
            35, 389, 773, 1127, 1482, 1866, 2220, 2605, 2959, 3313, 3697, 4051, 4405, 4789, 5144, 5528, 5882, 6237, 6621, 6975,
            7329, 7713, 8067, 8422, 8806, 9160, 9544, 9898, 10252, 10636, 10991, 11345, 11729, 12084, 12468, 12822, 13176, 13560, 13914, 14268,
            14652, 15007, 15362, 15746, 16100, 16484, 16838, 17192, 17576, 17930, 18285, 18669, 19024, 19408, 19762, 20116, 20499, 20854, 21208, 21592,
            21947, 22301, 22685, 23039, 23423, 23777, 24132, 24516, 24870, 25225, 25609, 25963, 26347, 26701, 27055, 27439, 27794, 28148, 28532, 28887,
            29241, 29625, 29979, 30363, 30717, 31072, 31456, 31810, 32165, 32548, 32902, 33286, 33640, 33995, 34379, 34734, 35088, 35472, 35826, 36180};
    private static final int[] L_BITS = {
            0x0693, 0x152B, 0x052B, 0x0A5B, 0x155A, 0x056A, 0x1B55, 0x0BA4, 0x0B49, 0x1A93, 0x0A95, 0x052D, 0x0AAD, 0x0AB5, 0x15AA, 0x05D2, 0x0DA5, 0x1D4A, 0x0D4A, 0x0C95,
            0x152E, 0x0556, 0x0AB5, 0x15B2, 0x06D2, 0x0EA5, 0x0725, 0x064B, 0x0C97, 0x0CAB, 0x055A, 0x0AD6, 0x0B69, 0x1752, 0x0B52, 0x0B25, 0x1A4B, 0x0A4B, 0x04AB, 0x055B,
            0x05AD, 0x0B6A, 0x1B52, 0x0D92, 0x1D25, 0x0D25, 0x0A55, 0x14AD, 0x04B6, 0x05B5, 0x0DAA, 0x0EC9, 0x1E92, 0x0E92, 0x0D26, 0x0A56, 0x0A57, 0x0556, 0x06D5, 0x0755,
            0x0749, 0x0E93, 0x0693, 0x152B, 0x052B, 0x0A5B, 0x155A, 0x056A, 0x0B65, 0x174A, 0x0B4A, 0x1A95, 0x0A95, 0x052D, 0x0AAD, 0x0AB5, 0x05AA, 0x0BA5, 0x0DA5, 0x0D4A,
            0x1C95, 0x0C96, 0x194E, 0x0556, 0x0AB5, 0x15B2, 0x06D2, 0x0EA5, 0x0E4A, 0x068B, 0x0C97, 0x04AB, 0x055B, 0x0AD6, 0x0B6A, 0x0752, 0x1725, 0x0B45, 0x0A8B, 0x0000};
    private static final int[] L_LEAP = {
            0, 4, 0, 0, 2, 0, 7, 0, 0, 5, 0, 0, 4, 0, 9, 0, 0, 6, 0, 0,
            4, 0, 0, 2, 0, 6, 0, 0, 5, 0, 0, 3, 0, 11, 0, 0, 6, 0, 0, 5,
            0, 0, 2, 0, 7, 0, 0, 5, 0, 0, 3, 0, 8, 0, 0, 6, 0, 0, 4, 0,
            0, 3, 0, 7, 0, 0, 5, 0, 0, 4, 0, 8, 0, 0, 6, 0, 0, 4, 0, 0,
            3, 0, 7, 0, 0, 5, 0, 0, 4, 0, 8, 0, 0, 6, 0, 0, 4, 0, 0, 0};

    private Lunar() {}

    private static long daysSince2000(int y, int m, int d) {   // Howard Hinnant 演算法
        y -= (m <= 2) ? 1 : 0;
        long era = (y >= 0 ? y : y - 399) / 400;
        long yoe = y - era * 400;
        long doy = (153L * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
        long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return era * 146097 + doe - 719468 - 10957;
    }

    /** 例如「丙午年（馬）九月初三」；超出表格範圍回傳空字串。 */
    static String full(Date date) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Asia/Taipei"));
        c.setTime(date);
        long d = daysSince2000(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
        int yi = -1;
        for (int i = 0; i < L_CNY.length - 1; i++)
            if (d >= L_CNY[i] && d < L_CNY[i + 1]) { yi = i; break; }
        if (yi < 0) return "";
        long off = d - L_CNY[yi];
        int leap = L_LEAP[yi], n = leap != 0 ? 13 : 12, month = 1, day = 1;
        boolean isLeap = false;
        for (int i = 0; i < n; i++) {
            int len = ((L_BITS[yi] >> i) & 1) != 0 ? 30 : 29;
            if (off < len) {
                if (leap == 0 || i < leap) month = i + 1;
                else if (i == leap) { month = leap; isLeap = true; }
                else month = i;
                day = (int) off + 1;
                break;
            }
            off -= len;
        }
        final String[] MN = {"正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "臘"};
        final String[] DG = {"一", "二", "三", "四", "五", "六", "七", "八", "九"};
        final String[] TP = {"初", "十", "廿"};
        String ds = day == 10 ? "初十" : day == 20 ? "二十" : day == 30 ? "三十" : TP[day / 10] + DG[day % 10 - 1];
        int ygz = (((FIRST_YEAR + yi - 4) % 60) + 60) % 60;
        return STEM[ygz % 10] + BRANCH[ygz % 12] + "年（" + ZODIAC[ygz % 12] + "）" + (isLeap ? "閏" : "") + MN[month - 1] + "月" + ds;
    }
}
