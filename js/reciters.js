// قائمة القراء.
// everyayah: اسم الفولدر على https://everyayah.com/data/<folder>/SSSAAA.mp3
// islamic: (اختياري) اسم الإصدار على https://cdn.islamic.network/quran/audio/<bitrate>/<edition>/<globalAyah>.mp3
// featured: يظهر في القائمة المختصرة (الأشهر).
// qurancom: رقم التلاوة على Quran.com — عندها توقيت كل كلمة (لخاصية ظهور الكلمات مع التلاوة).

export const RECITERS = [
  { id: 'alafasy', qurancom: 7, name: 'مشاري راشد العفاسي', everyayah: 'Alafasy_128kbps', islamic: 'ar.alafasy', featured: true },
  { id: 'abdulbasit-murattal', qurancom: 2, name: 'عبد الباسط عبد الصمد (مرتل)', everyayah: 'Abdul_Basit_Murattal_192kbps', islamic: 'ar.abdulbasitmurattal', featured: true },
  { id: 'abdulbasit-mujawwad', qurancom: 1, name: 'عبد الباسط عبد الصمد (مجود)', everyayah: 'Abdul_Basit_Mujawwad_128kbps', featured: true },
  { id: 'minshawi-murattal', qurancom: 9, name: 'محمد صديق المنشاوي (مرتل)', everyayah: 'Minshawy_Murattal_128kbps', islamic: 'ar.minshawi', featured: true },
  { id: 'minshawi-mujawwad', qurancom: 8, name: 'محمد صديق المنشاوي (مجود)', everyayah: 'Minshawy_Mujawwad_192kbps', islamic: 'ar.minshawimujawwad', featured: true },
  { id: 'husary', qurancom: 6, name: 'محمود خليل الحصري', everyayah: 'Husary_128kbps', islamic: 'ar.husary', featured: true },
  { id: 'husary-muallim', qurancom: 12, name: 'محمود خليل الحصري (المعلم)', everyayah: 'Husary_Muallim_128kbps' },
  { id: 'sudais', qurancom: 3, name: 'عبد الرحمن السديس', everyayah: 'Abdurrahmaan_As-Sudais_192kbps', islamic: 'ar.abdurrahmaansudais', featured: true },
  { id: 'shuraim', qurancom: 10, name: 'سعود الشريم', everyayah: 'Saood_ash-Shuraym_128kbps', islamic: 'ar.saoodshuraym', featured: true },
  { id: 'dossari', name: 'ياسر الدوسري', everyayah: 'Yasser_Ad-Dussary_128kbps', featured: true },
  { id: 'maher', name: 'ماهر المعيقلي', everyayah: 'MaherAlMuaiqly128kbps', islamic: 'ar.mahermuaiqly', featured: true },
  { id: 'ghamdi', name: 'سعد الغامدي', everyayah: 'Ghamadi_40kbps', featured: true },
  { id: 'hudhaify', name: 'علي الحذيفي', everyayah: 'Hudhaify_128kbps', islamic: 'ar.hudhaify', featured: true },
  { id: 'ayyoub', name: 'محمد أيوب', everyayah: 'Muhammad_Ayyoub_128kbps', islamic: 'ar.muhammadayyoub', featured: true },
  { id: 'qatami', name: 'ناصر القطامي', everyayah: 'Nasser_Alqatami_128kbps', featured: true },
  { id: 'shaatree', qurancom: 4, name: 'أبو بكر الشاطري', everyayah: 'Abu_Bakr_Ash-Shaatree_128kbps', islamic: 'ar.shaatree', featured: true },
  { id: 'ajamy', name: 'أحمد بن علي العجمي', everyayah: 'Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net', islamic: 'ar.ahmedajamy' },
  { id: 'jibreel', name: 'محمد جبريل', everyayah: 'Muhammad_Jibreel_128kbps', islamic: 'ar.muhammadjibreel' },
  { id: 'tablawi', qurancom: 11, name: 'محمد محمود الطبلاوي', everyayah: 'Mohammad_al_Tablaway_128kbps' },
  { id: 'banna', name: 'محمود علي البنا', everyayah: 'mahmoud_ali_al_banna_32kbps' },
  { id: 'mustafa-ismail', name: 'مصطفى إسماعيل', everyayah: 'Mustafa_Ismail_48kbps' },
  { id: 'basfar', name: 'عبد الله بصفر', everyayah: 'Abdullah_Basfar_192kbps', islamic: 'ar.abdullahbasfar' },
  { id: 'rifai', qurancom: 5, name: 'هاني الرفاعي', everyayah: 'Hani_Rifai_192kbps', islamic: 'ar.hanirifai' },
  { id: 'budair', name: 'صلاح البدير', everyayah: 'Salah_Al_Budair_128kbps' },
  { id: 'qahtani', name: 'خالد القحطاني', everyayah: 'Khaalid_Abdullaah_al-Qahtaanee_192kbps' },
  { id: 'juhany', name: 'عبد الله عواد الجهني', everyayah: 'Abdullaah_3awwaad_Al-Juhaynee_128kbps' },
  { id: 'muhsin', name: 'محسن القاسم', everyayah: 'Muhsin_Al_Qasim_192kbps' },
  { id: 'akhdar', name: 'إبراهيم الأخضر', everyayah: 'Ibrahim_Akhdar_32kbps', islamic: 'ar.ibrahimakhbar' },
  { id: 'ali-jaber', name: 'علي جابر', everyayah: 'Ali_Jaber_64kbps' },
  { id: 'fares', name: 'فارس عباد', everyayah: 'Fares_Abbad_64kbps' },
  { id: 'ayman-sowaid', name: 'أيمن سويد', everyayah: 'Ayman_Sowaid_64kbps', islamic: 'ar.aymanswoaid' },
  { id: 'warsh-dossary', name: 'إبراهيم الدوسري (رواية ورش)', everyayah: 'warsh/warsh_ibrahim_aldosary_128kbps' },
];

// فولدر مخصص يكتبه المستخدم (لو القارئ مش موجود في القائمة)
export function customReciter(folder) {
  return { id: 'custom:' + folder, name: 'مخصص: ' + folder, everyayah: folder };
}

export function findReciter(id) {
  if (id && id.startsWith('custom:')) return customReciter(id.slice(7));
  return RECITERS.find(r => r.id === id) || RECITERS[0];
}

const pad3 = n => String(n).padStart(3, '0');

// كل الروابط المحتملة لملف آية، بالترتيب
export function ayahAudioUrls(reciter, surah, ayah, globalAyah) {
  const urls = [];
  if (reciter.everyayah) {
    urls.push(`https://everyayah.com/data/${reciter.everyayah}/${pad3(surah)}${pad3(ayah)}.mp3`);
  }
  if (reciter.islamic) {
    for (const br of [128, 192, 64]) {
      urls.push(`https://cdn.islamic.network/quran/audio/${br}/${reciter.islamic}/${globalAyah}.mp3`);
    }
  }
  return urls;
}
