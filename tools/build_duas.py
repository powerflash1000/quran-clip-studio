#!/usr/bin/env python3
"""يبني data/duas.json: أدعية القرآن (مراجع آيات) + أدعية من السنة (من كتب الدعاء في الكتب الستة).

التشغيل:
  python3 tools/build_duas.py <فولدر فيه ara-<كتاب>.json من fawazahmed0/hadith-api>
الملفات: https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/ara-<كتاب>.min.json
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HADITH_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'tmp-hadith'

HARAKAT = re.compile(r'[ؐ-ًؚ-ٰٟۖ-ۭـ]')


def skel(t):
    t = HARAKAT.sub('', t)
    t = re.sub('[أإآٱ]', 'ا', t).replace('ى', 'ي').replace('ة', 'ه').replace('ۥ', '').replace('ۦ', '')
    return re.sub(r'[^ء-ي ]', '', t).strip()


# ===== أدعية القرآن =====
# كل دعاء = موضوع + أجزاء. الجزء: (سورة، آية) أو (سورة، من، لحد) أو (سورة، آية، {start, nth, end})
# آية لوحدها من غير start: لو بتبدأ بـ «رب/ربنا» بتتاخد كاملة، وإلا من أول «رب/ربنا»
Q = [
    ('الهداية والثبات', [(1, 6, 7)]),
    ('القبول والتوبة', [(2, 127)]),
    ('القبول والتوبة', [(2, 128)]),
    ('الدنيا والآخرة', [(2, 201)]),
    ('الصبر والنصر', [(2, 250)]),
    ('المغفرة والرحمة', [(2, 285, {'start': 'غفرانك'})]),
    ('المغفرة والرحمة', [(2, 286)]),
    ('الهداية والثبات', [(3, 8, 9)]),
    ('المغفرة والرحمة', [(3, 16)]),
    ('الرزق والخير', [(3, 26, 27)]),
    ('الذرية والأهل', [(3, 38)]),
    ('الهداية والثبات', [(3, 53)]),
    ('المغفرة والرحمة', [(3, 147)]),
    ('الهم والكرب', [(3, 173, {'start': 'حسبنا'})]),
    ('الدنيا والآخرة', [(3, 191), (3, 192, 194)]),
    ('الهداية والثبات', [(5, 83)]),
    ('المغفرة والرحمة', [(7, 23)]),
    ('الصبر والنصر', [(7, 47)]),
    ('الصبر والنصر', [(7, 89)]),
    ('حسن الخاتمة', [(7, 126)]),
    ('المغفرة والرحمة', [(7, 151)]),
    ('الهم والكرب', [(9, 129, {'start': 'حسبي'})]),
    ('الصبر والنصر', [(10, 85), (10, 86)]),
    ('الاستعاذة', [(11, 47)]),
    ('السفر', [(11, 41, {'start': 'بسم'})]),
    ('الهم والكرب', [(12, 86, {'start': 'انما', 'end': 'الله'})]),
    ('حسن الخاتمة', [(12, 101)]),
    ('الرزق والخير', [(14, 35)]),
    ('الوالدين', [(14, 40, 41)]),
    ('الوالدين', [(17, 24)]),
    ('الهداية والثبات', [(17, 80)]),
    ('الهداية والثبات', [(18, 10)]),
    ('العلم وشرح الصدر', [(20, 25), (20, 26, 28)]),
    ('العلم وشرح الصدر', [(20, 114)]),
    ('الهم والكرب', [(21, 83, {'start': 'اني'})]),
    ('الهم والكرب', [(21, 87, {'start': 'لا'})]),
    ('الذرية والأهل', [(21, 89)]),
    ('الرزق والخير', [(23, 29)]),
    ('الاستعاذة', [(23, 94)]),
    ('الاستعاذة', [(23, 97), (23, 98)]),
    ('المغفرة والرحمة', [(23, 109)]),
    ('المغفرة والرحمة', [(23, 118)]),
    ('الدنيا والآخرة', [(25, 65), (25, 66)]),
    ('الذرية والأهل', [(25, 74)]),
    ('حسن الخاتمة', [(26, 83, 85), (26, 87, 89)]),
    ('الهداية والثبات', [(27, 19)]),
    ('المغفرة والرحمة', [(28, 16, {'end': 'لي'})]),
    ('الهم والكرب', [(28, 21)]),
    ('الرزق والخير', [(28, 24)]),
    ('الصبر والنصر', [(29, 30)]),
    ('الذرية والأهل', [(37, 100)]),
    ('الهم والكرب', [(40, 44, {'start': 'وافوض'})]),
    ('المغفرة والرحمة', [(40, 7), (40, 8, 9)]),
    ('السفر', [(43, 13, {'start': 'سبحن'}), (43, 14, 14)]),
    ('المغفرة والرحمة', [(44, 12)]),
    ('الوالدين', [(46, 15)]),
    ('المغفرة والرحمة', [(59, 10)]),
    ('الهم والكرب', [(60, 4), (60, 5)]),
    ('الدنيا والآخرة', [(66, 8)]),
    ('الدنيا والآخرة', [(66, 11)]),
    ('الوالدين', [(71, 28)]),
    ('الهم والكرب', [(2, 156, {'start': 'انا'})]),
]


# «رَبِّ» أو «رَبَّنَا» (منادى بالفتح) — مش «رَبُّنَا» ولا «رَبِّنَا»
def vocative(word, sk):
    return sk == 'رب' or (sk == 'ربنا' and re.search('ب(\u0651\u064e|\u064e\u0651)', word) is not None)


def quran_items():
    verses = json.load(open(ROOT / 'data/quran.json', encoding='utf-8'))['verses']
    words = lambda s, a: verses[s - 1][a - 1][0].split()
    out = []
    for topic, segs in Q:
        parts = []
        for n, seg in enumerate(segs):
            s, a = seg[0], seg[1]
            if len(seg) == 3 and isinstance(seg[2], int):
                parts.append({'s': s, 'a': a, 'b': seg[2]})
                continue
            opt = seg[2] if len(seg) == 3 else {}
            ws = words(s, a)
            sk = [skel(w) for w in ws]
            start = opt.get('start')
            if start:
                hits = [i for i, w in enumerate(sk) if w == start or w.startswith(start)]
            elif n:
                hits = [0]  # تكملة الدعاء في الآية اللي بعدها: كاملة
            else:
                hits = [i for i, w in enumerate(sk) if vocative(ws[i], w)]
            if not hits:
                if start:
                    raise SystemExit(f'مالقيتش «{start}» في {s}:{a}')
                hits = [0]
            w1 = hits[min(opt.get('nth', 1), len(hits)) - 1] + 1
            w2 = len(ws)
            if opt.get('end'):
                e = [i for i, w in enumerate(sk) if i >= w1 - 1 and w == opt['end']]
                if not e:
                    raise SystemExit(f'مالقيتش النهاية «{opt["end"]}» في {s}:{a}')
                w2 = e[0] + 1
                # علامة الوقف اللي بعد الكلمة (لو منفصلة) مش لازمة
            p = {'s': s, 'a': a}
            if w1 > 1 or w2 < len(ws):
                p['w1'], p['w2'] = w1, w2
            parts.append(p)
        out.append({'topic': topic, 'parts': parts})
    return out


# ===== أدعية من السنة =====
BOOKS = [
    ('bukhari', 80, 'البخاري'),
    ('muslim', 48, 'مسلم'),
    ('tirmidhi', 48, 'الترمذي'),
    ('abudawud', 8, 'أبو داود'),
    ('abudawud', 43, 'أبو داود'),
    ('nasai', 50, 'النسائي'),
    ('ibnmajah', 34, 'ابن ماجه'),
]
SAHIH = {'bukhari', 'muslim'}
# بداية الدعاء جوه كلام النبي ﷺ
MARKERS = ['اللَّهُمَّ', 'أَعُوذُ', 'سُبْحَانَ', 'لاَ إِلَهَ إِلاَّ', 'أَسْتَغْفِرُ', 'الْحَمْدُ لِلَّهِ', 'حَسْبِيَ', 'يَا مُقَلِّبَ', 'يَا حَيُّ', 'بِسْمِ اللَّهِ', 'رَبِّ اغْفِرْ']
QUOTE = re.compile(r'‏?\s*"\s*‏?')

# أول موضوع بيطابق هو اللي بيتاخد — الأخص الأول
TOPICS = [
    ('الهم والكرب', r'الهم |الحزن|كرب|الغم|غلبه الدين|ضلع الدين|المغرم'),
    ('العافية والشفاء', r'عافي|العافيه|اشف|الشافي|شفاء|سقم|البرص|الجنون|الاسقام|بدني|سمعي|بصري'),
    ('الرزق والخير', r'رزق|الغني|الفقر|بارك|اغنني|حلالك'),
    ('الهداية والثبات', r'اهدن|اهدني|الهدي|ثبت|قلبي|قلوبنا|مقلب|سددني|التقي|زكها|تقواها'),
    ('السفر', r'السفر|سفرنا'),
    ('النوم والاستيقاظ', r'جنبي|مضجع|فراش|احيانا بعد ما اماتنا|باسمك اموت|نفسي فاغفر'),
    ('المغفرة والرحمة', r'اغفر|استغفر|مغفر|ذنوب|ذنبي|خطاي|التواب|ارحم'),
    ('الدنيا والآخرة', r'الجنه|النار|الاخره|القبر|الدنيا|حسنه'),
    ('العلم', r'علما|علمني|العلم'),
    ('التسبيح والحمد', r'^سبحان|^الحمد لله|^لا اله الا|الله اكبر|لا حول'),
    ('الاستعاذة', r'اعوذ|عياذ'),
]


def grade_of(col, h):
    if col in SAHIH:
        return 'صحيح'
    g = next((x['grade'] for x in h.get('grades', []) if x['name'] == 'Al-Albani'), '')
    g = g.lower()
    if 'daif' in g or "da'if" in g or 'mawdu' in g or 'munkar' in g or 'shadh' in g:
        return None
    if 'sahih' in g:
        return 'صحيح (الألباني)'
    if 'hasan' in g:
        return 'حسن (الألباني)'
    return None


HARAKA = '[\u064B-\u0652\u0670]*'
MARKER_RX = re.compile('|'.join(HARAKA.join(re.escape(ch) for ch in skel(m).replace(' ', '\x00')).replace('\x00', r'\s+') for m in MARKERS))
# اللي بعد الدعاء: كلام الراوي أو شرح النبي ﷺ (مش من الدعاء)
NARRATION = re.compile(r'\s(?:قَالَ|قَالَتْ|قال|فَقَالَ|ثُمَّ قَالَ|يَعْنِي|وَكَانَ|إِذَا|فَإِذَا|مَنْ قَالَهَا|فَإِنْ)\s')

# «مِائَةَ مَرَّةٍ» وما بعدها = عدد مرات وفضل، مش من الدعاء
COUNT = re.compile(r'\s\S+\sمَرَّ(?:ةٍ|اتٍ)')
# مش دعاء: أمر للصحابة، أو تعجّب («سبحان الله!»)، أو مثال للنهي («اللهم اغفر لي إن شئت»)
NOT_DUA = re.compile(r'استغفروا|سبحانه|سبحان الله لا|.*ان شئت')


def extract(text):
    parts = QUOTE.split(text)
    # الأجزاء الفردية (1، 3، ...) هي الكلام اللي بين علامات التنصيص
    best = None
    for seg in parts[1::2]:
        if re.search(r'[(){}]', seg):
            continue  # فيها آيات بين قوسين
        seg = re.sub(r'\s+', ' ', seg)
        m = MARKER_RX.search(skel_keep(seg))
        if not m:
            continue
        seg = seg[m.start():]
        # الجمل: نكمّل بس لو الجملة اللي بعدها دعاء كمان
        sents = re.split(r'\s*\u200f?\.\u200f?\s*', seg)
        keep = [sents[0]]
        for x in sents[1:]:
            if x and MARKER_RX.match(skel_keep(x)):
                keep.append(x)
            else:
                break
        dua = ' '.join(keep)
        for rx in (NARRATION, COUNT, re.compile(r'\s-\s')):
            n = rx.search(dua)
            if n:
                dua = dua[:n.start()]
        if NOT_DUA.match(skel(dua)):
            continue
        dua = dua.strip(' .،,\u200f')
        if 28 <= len(dua) <= 700 and (best is None or len(dua) > len(best)):
            best = dua
    return best


def skel_keep(t):
    # نفس النص بس الحروف المتشابهة متوحدة (الطول مايتغيرش عشان المواقع تفضل صح)
    return re.sub('[أإآٱ]', 'ا', t).replace('ى', 'ي')


def norm(t):
    return re.sub(r'\s+', '', skel(t))


def dup(a, b):
    short, long_ = sorted((a, b), key=len)
    return bool(short) and short in long_ and len(short) > 0.7 * len(long_)


def sunnah_items():
    out, seen = [], []
    azk = json.load(open(ROOT / 'data/azkar.json', encoding='utf-8'))
    for c in azk['categories']:
        for it in c['items']:
            seen.append(norm(it['t']))
    for col, book, name in BOOKS:
        f = HADITH_DIR / f'ara-{col}.json'
        if not f.exists():
            raise SystemExit(f'ناقص {f}')
        data = json.load(open(f, encoding='utf-8'))
        for h in data['hadiths']:
            if h['reference']['book'] != book:
                continue
            g = grade_of(col, h)
            if not g:
                continue
            dua = extract(h['text'])
            if not dua:
                continue
            key = norm(dua)
            if any(dup(key, s) for s in seen):
                continue
            seen.append(key)
            num = str(h['arabicnumber']).split('.')[0]
            sk = skel(dua)
            topic = next((t for t, rx in TOPICS if re.search(rx, sk)), 'أدعية جامعة')
            if re.match(r'(اللهم اني )?اعوذ', sk) and topic != 'الهم والكرب':
                topic = 'الاستعاذة'
            out.append({'t': dua, 'r': f'رواه {name} ({num})', 'g': g, 'topic': topic})
    return out


def main():
    q = quran_items()
    s = sunnah_items()
    json.dump({'quran': q, 'sunnah': s}, open(ROOT / 'data/duas.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'quran {len(q)}, sunnah {len(s)}')


if __name__ == '__main__':
    main()
