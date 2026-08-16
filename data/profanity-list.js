// 비속어/욕설 필터 목록 (하드코딩)
// 대사 검색 시 입력된 텍스트에 이 목록의 단어가 포함되어 있으면 차단합니다.
module.exports = new Set([
    // ═════════════════════════════════════════════════════════════════
    // 1. 한국어 - 기본 욕설 및 변형 (Primary Swears & Variations)
    // ═════════════════════════════════════════════════════════════════
    "씨발", "시발", "씨바라", "씨바라마", "시바라마",
    "씨부레", "시부레", "씨부리", "시부리", "쉬발", "슈발", "쉬벌", "슈벌",
    "야발", "아발", "야발련", "야발롬", "씨이발", "시이발",

    // ── 씹 계열 ──
    "씹새", "씹쌔", "씹년", "씹놈", "씹것", "씹자식", "씹창", "씹덕",
    "씹창남", "씹창녀", "씹창났", "씹창나", "씹버러지", "씹자루", "씹할", "씹팔",
    "씹년아", "씹놈아", "씹할놈", "씹할년", "씹선비", "씹수", "씹질", "씹구녕",
    "씹물", "씹구멍", "씹귀", "씹극혐", "씹노답", "씹뇌절", "씹쌉", "씹하타치",
    "씹상타치", "씹인정", "씹호구", "개씹", "니미씹",

    // ── 좆/좃 계열 ──
    "좆", "좆같", "좆나", "좆까", "좆밥", "좆만", "좆대", "좆망", "좆도", "좆털",
    "좆빨", "좆대가리", "좆대가린", "좆구려", "좆먹", "좆병신", "좆지랄", "좆씹",
    "좆꼴", "좆같은", "좆밥새끼", "좆도없", "좆까라", "좆까세요", "좆뺑이", "좆부심",
    "좆문가", "좆목", "좆목질", "좆잡고", "좆물", "좆꼴려", "좆터져", "개좆",
    "좃", "좃같", "좃나", "좃까", "좃밥", "좃망", "좃털", "좃도", "좃대가리",
    "좃구려", "좃병신", "좃까라", "좃문가", "좃목", "실좆", "개자지", "개보지",

    // ── 개새끼 계열 ──
    "개새끼", "개새기", "개새꺄", "개세끼", "개세기", "개색끼", "개색기", "개색히",
    "개쉐이", "개쉐끼", "개쌔끼", "개섀끼", "개섀키", "개뇬", "개뇸", "개자식", "개자슥",
    "개년아", "개놈아", "개미친", "개지랄",
    "개쓰레기", "개망나니", "개잡놈", "개잡년", "개쌍놈", "개쌍년",
    "개꼴통", "개또라이", "개진상", "개망신", "개호로", "개호루", "개허접", "개버러지",
    "개꼴", "개꼴됐",

    // ── 병신/등신 계열 ──
    "병신", "병싄", "븅신", "븡신", "뵹신", "병시나", "븅시나", "병딱", "병맛", "병크",
    "병먹금", "병신새끼", "븅신새끼", "병신년", "븅신년", "병신놈", "븅신놈",
    "등신아", "등신새끼", "등신놈", "등신년", "상등신",

    // ── 지랄/염병/육갑 계열 ──
    "지랄", "지랄하", "지럴", "지롤", "쥐랄", "즤랄", "즈랄", "지랄발광", "지랄염병",
    "지랄똥", "지랄견", "지랄마", "지랄노", "지랄옆차기", "염병", "얌병", "옘병",
    "옘병할", "염병할", "육갑", "육갑하", "육시랄", "육시럴", "썩을년", "썩을놈",
    "썩을새끼", "썅놈", "썅년", "썅새끼", "쌍놈", "쌍년", "쌍새끼", "시방새", "씨방새",
    "시방놈", "씨방놈",

    // ── 초성 및 약어 ──
    "ㅆㅂ", "ㅅㅂ", "ㅂㅅ", "ㅈㄹ", "ㅅㅂㄹㅁ", "ㄱㅅㄲ", "ㅈㄴ", "ㅁㅊ", "ㅄ",
    "ㅅㅂㄴ", "ㅅㅂㄹ", "ㅆㅂㄹ", "ㅈ같", "ㅈ까", "ㅈ밥", "ㅈ대", "ㅈ망", "ㅈ나게",
    "ㅆㄹ", "ㅄㅋ", "ㅂㅅㅋ", "凸", "ㅗ", "凸ㅗ", "凸^ㅗ^凸", "ㅗㅜㅑ", "ㅗㅗ",

    // ═════════════════════════════════════════════════════════════════
    // 2. 한국어 - 패드립 및 가족 모욕 (Family / Ancestor Insults)
    // ═════════════════════════════════════════════════════════════════
    "느금마", "느그마", "느금", "느금빠", "느그빠", "느개비", "느그애비", "느그아부지",
    "니미럴", "니미랄", "니미씹", "니미새끼", "니미뽕", "늬미", "늬미럴", "늬미새끼",
    "느금마창녀", "느금마보지", "느개비자지",
    "엠창", "엠생", "엠뒤", "엠장", "앰생", "앰뒤", "엠창인생", "앰창인생", "엠뒤인생",
    "애미뒤", "애비뒤", "애미터짐", "애비터짐", "애미창녀", "애비창놈", "애미뒤진", "애비뒤진",
    "부모뒤진", "부모홀수", "애미홀수", "애비홀수",
    "고아새끼", "고아새기", "고아년", "고아놈", "상고아", "호로새끼", "호로자식", "호로놈",
    "호로년", "호로잡놈", "패륜", "패륜아", "패륜녀", "패륜남",

    // ═════════════════════════════════════════════════════════════════
    // 3. 한국어 - 성적 비속어 / 음란 / 성희롱 (Sexual Terms & Harassment)
    // ═════════════════════════════════════════════════════════════════
    "보지년", "뷰지", "짬지", "백보지", "보짓물", "보징어", "보빨", "봊나", "봊풍당당",
    "쥬지", "좆물", "자짓물", "자빨", "좆빨", "클리토리스", "클리", "젖꼭지",
    "젖탱이", "슴골", "핑두", "흑두", "핑유", "흑유", "핑보", "흑보", "음경",
    "포경", "질외사정", "사정액", "쿠퍼액", "애액",
    "후장", "항문", "애널", "똥꼬", "똥구멍", "똥구녕", "떵꼬", "똥까시", "즈위", "딸딸이", "자위", "ㄸㄸㅇ",
    "사까시", "사까시년", "사까시놈", "펠라", "펠라치오", "오랄", "딥쓰롯", "파이즈리", "대딸",
    "떡치", "떡치다", "떡치자", "섹스", "쎅스", "쎄스", "ㅅㅅ", "섹스해", "야스", "얍스", "성교",
    "성관계", "붕가", "붕가붕가", "박아", "박아줘", "박아줄", "박아드림", "따먹", "따먹어", "따먹을",
    "걸레", "걸레년", "걸레놈", "걸레새끼", "화냥년", "화냥놈", "갈보", "갈보년", "창녀", "창녀새끼",
    "매춘부", "매춘녀", "매춘놈", "성매매", "몸파는", "룸빵", "안마방", "키스방",
    "발기놈", "발기년", "발기부전", "조루", "조루새끼", "음란마귀", "최음제",
    "딜도", "오나홀", "바이브레이터", "텐가",
    "야동", "야설", "야짤", "포르노", "폰헙", "폰허브", "히토미", "넷섹", "폰섹", "카섹", "몸캠",
    "알몸", "나체", "노브라", "팬티", "팬티스타킹", "팬스", "빤쓰", "브라자", "유방", "거유", "빈유",
    "로리", "로리콘", "쇼타", "쇼타콘", "페도", "페도필리아",
    "유사강간", "강간", "강간범", "강간해", "강간당", "윤간", "수간", "근친", "몰카", "도촬",
    "능욕", "능간", "갱뱅", "노출증", "관음증",

    // ═════════════════════════════════════════════════════════════════
    // 7. 한국어 - 우회 / 필터 회피 / 특수문자 / 영타 변형 (Korean Filter Bypasses & Typo Variations)
    // ═════════════════════════════════════════════════════════════════
    "시1발", "씨1발", "시2발", "씨2발", "시3발", "씨3발", "시!발", "씨!발", "시@발", "씨@발",
    "시#발", "씨#발", "시$발", "씨$발", "시*발", "씨*발", "시^발", "씨^발", "시_발", "씨_발",
    "개1새끼", "개2새끼", "개!새끼", "개@새끼", "개#새끼", "개*새끼", "개새1끼", "개새2끼",
    "개새!끼", "개새@끼",
    "병1신", "병2신", "병!신", "병@신", "병#신", "병*신", "븅1신", "븅!신", "ㅂ1ㅅ", "ㅂ2ㅅ",
    "ㅂ!ㅅ", "ㅂ@ㅅ",
    "좆1같", "좆2같", "좆!같", "좆@같", "좃1같", "좃!같", "ㅈ1같", "ㅈ2같",
    "s발", "c발", "si발", "ssi발", "ㅅ발", "ㅆ발", "tl발",
    "tlqkf", "tlqkfsk", "tlqkf년", "tlqkf놈", "tlqkffus", "tlqkfsha", "tlqkfToRl",
    "rhotRrl", "rhotrl", "rhtRrl", "rhtrl", "qudtls", "wlfkf", "whr", "whrkx", "dladn",

    // ═════════════════════════════════════════════════════════════════
    // 8. 영어 - Fuck 계열 및 변형 (English Fuck & Derivatives)
    // ═════════════════════════════════════════════════════════════════
    "fuck", "fucks", "fucked", "fucking", "fucker", "fuckers", "fuckin", "fuckhead",
    "fuckheads", "fuckface", "fuckfaces", "fuckboy", "fuckboi", "fuck off", "fuckoff",
    "fuck you", "fuckyou", "fuck u", "fucku", "motherfuck", "motherfucker", "motherfuckers",
    "motherfucking", "motherfuckin", "mother fucker", "mother fuck", "mother fucking",
    "mofo", "muthafucka", "muthafucker", "mo fo",
    "fck", "f*ck", "f**k", "f u c k", "f u c k e r", "fuk", "fukk", "fukker", "fukking",
    "fuxk", "phuck", "phuk", "phuq", "fak", "fakk", "faking", "fuckwit", "fuckbag",
    "fuckstick", "fucknut", "fucknuts", "fucktard", "fucktards", "clusterfuck", "unfuck",
    "mindfuck", "fuckup", "fuck up", "fuckfest", "fuckery", "what the fuck", "wtf",
    "stfu", "shut the fuck up", "wth", "omfg",

    // ═════════════════════════════════════════════════════════════════
    // 9. 영어 - Shit 계열 및 변형 (English Shit & Derivatives)
    // ═════════════════════════════════════════════════════════════════
    "shit", "shits", "shitted", "shitting", "shitty", "shittier", "shittiest",
    "shithead", "shitheads", "shitface", "shitfaced", "shitbag", "shitbags",
    "shithole", "shitholes", "shitshow", "shit stain", "shitstain", "shitbox",
    "shitpost", "shitposter", "shitposting", "shitload",
    "bullshit", "bullshitter", "bullshitting", "dipshit", "dipshits", "batshit",
    "horseshit", "dogshit", "chickenshit", "apeshit", "holy shit", "holyshit",
    "no shit", "eat shit", "piece of shit", "sh*t", "sh!t", "s h i t", "shite",
    "shat", "shitebag", "shittalk",

    // ═════════════════════════════════════════════════════════════════
    // 10. 영어 - Bitch / Bastard / Ass / Crap 계열 (English Bitch, Bastard, Ass & Crap)
    // ═════════════════════════════════════════════════════════════════
    "bitch", "bitches", "bitching", "bitched", "bitchy", "bitchass", "bitch ass",
    "son of a bitch", "sonofabitch", "son of bitch", "sob", "b!tch", "b*tch",
    "b i t c h", "biatch", "biyatch", "beeotch", "bitchface", "bitchtits",
    "basic bitch", "little bitch", "dumb bitch", "crazy bitch",
    "bastard", "bastards", "bastid", "b@stard", "bastardize", "fat bastard",
    "dirty bastard", "lucky bastard", "dumb bastard", "sick bastard",
    "asshole", "assholes", "arsehole", "arseholes", "arse", "arses", "arsehead",
    "arseface", "arse wipe", "arsewipe", "dumbass", "dumbasses", "jackass",
    "jackasses", "bad ass", "badass", "badasses", "fatass", "fatasses", "lazyass",
    "smartass", "smartasses", "hardass", "tightass", "kickass", "bigass", "crazyass",
    "uglyass", "brokeass", "cheapass", "candyass", "piece of ass", "kiss ass",
    "kissass", "kissasser", "brown nose", "brownnoser", "asshead", "assface",
    "ass clown", "assclown", "asshat", "asshats", "asswipe", "asswipes", "ass munch",
    "assmunch", "ass bag", "assbag", "ass bandit", "ass cracker", "ass lick",
    "asslick", "asslicker", "ass sucking", "ass sucker", "ass hole", "a$$hole", "a$$",
    "crap", "crappy", "craphead", "crapload", "crap shoot", "crapfest",

    // ═════════════════════════════════════════════════════════════════
    // 11. 영어 - Dick / Cock / Pussy / Cunt / 해부학적 비속어 (English Genitalia & Vulgarities)
    // ═════════════════════════════════════════════════════════════════
    "dick", "dicks", "dickhead", "dickheads", "dickface", "dickward", "dickweed",
    "dickbag", "dickbutt", "dickless", "dickwad", "dickhole", "dickrider",
    "dick riding", "dick sucking", "dick sucker", "eat a dick", "suck a dick",
    "d*ck", "d!ck", "d i c k",
    "cock", "cocks", "cocksucker", "cocksuckers", "cocksucking", "cockhead",
    "cockheads", "cockface", "cock sucker", "cocky", "cockbite", "cockblock",
    "cock blocked", "cock knocker", "cock mongrel", "cock ring", "cockring", "c*ck",
    "cunt", "cunts", "cunty", "cuntface", "cunting", "cuntbag", "cunt rag", "c*nt", "c u n t",
    "pussy", "pussies", "pussycat", "pussy whip", "pussywhipped", "pussyless",
    "grab by the pussy", "puss", "p*ssy", "pu$$y",
    "twat", "twats", "twatwaffle", "twatface", "twat head", "tw@t",
    "prick", "pricks", "prickhead", "prickface",
    "wanker", "wankers", "wank", "wanking", "wankstain", "wankfest",
    "bellend", "bell end", "knobhead", "knob head", "knob jockey", "knob", "knobs",
    "choad", "chode", "chodes",
    "cooter", "clit", "clitoris", "labia", "vagina", "vaginas", "penis", "penises",
    "ballsack", "ball sack", "scrotum", "nutsack", "nut sack", "testicles",
    "blue balls", "deez nuts", "deez nutz", "ligma", "sugma", "bofa", "bofa deez", "sugondeese",
    "boob", "boobs", "boobies", "tits", "titties", "titty", "titty fuck", "boob job",
    "sideboob", "underboob", "clevage", "cameltoe", "camel toe", "moose knuckle",
    "dildo", "dildos", "fleshlight", "vibrator", "buttplug", "butt plug",

    // ═════════════════════════════════════════════════════════════════
    // 12. 영어 - 성행위 / 음란 / 성희롱 (English Sexual Acts & Adult Content)
    // ═════════════════════════════════════════════════════════════════
    "blowjob", "blowjobs", "blow job", "blow jobs", "handjob", "handjobs", "hand job",
    "hand jobs", "footjob", "foot job", "titfuck", "tit fuck", "boob fuck",
    "deepthroat", "deep throat", "cum", "cums", "cumming", "cummed", "cumshot",
    "cumshots", "cum shot", "cum shots", "cumslut", "cum slut", "cum bucket",
    "cum dumpster", "cum rag", "cum stain", "cum swallow", "cum swallower",
    "bukkake", "creampie", "cream pie", "gangbang", "gang bang", "gangbanging",
    "gangbanged", "circlejerk", "circle jerk", "rimjob", "rim job", "rimming",
    "fingering", "pegging", "squirting", "squirt", "strap on", "strapon",
    "threesome", "foursome", "orgy", "orgies", "bdsm", "bondage", "dominatrix",
    "anal sex", "anal", "anal probing", "anal plug", "bareback", "barebacking",
    "gloryhole", "glory hole", "erotic", "erotica", "pornography", "porn",
    "hardcore porn", "softcore porn", "pornstar", "porn star", "porno",
    "pornhub", "xvideos", "xnxx", "redtube", "brazzers", "onlyfans", "nudes",
    "send nudes", "sext", "sexting", "cybersex", "masturbate", "masturbating",
    "masturbation", "jizz", "jizzing", "jizzed", "skeet", "nutted", "bust a nut",
    "ejaculated", "ejaculation", "boner", "boners", "hard on", "morning wood",
    "nympho", "nymphomaniac", "exhibitionist", "voyeur", "voyeurism",
    "scat", "scatology", "golden shower", "watersports", "pee on", "piss", "pissed",
    "pissing", "pisser", "piss off", "pissoff", "piss poor", "taking the piss",

    // ═════════════════════════════════════════════════════════════════
    // 13. 영어 - 혐오 표현 / 인종 / 성소수자 / 여성 / 종교 멸칭 (English Slurs, Bigotry & Hate Terms)
    // ═════════════════════════════════════════════════════════════════
    "nigger", "niggers", "niggar", "niggaz", "nigga", "niggas", "n1gger", "n1gga",
    "n!gger", "n!gga", "n i g g e r", "n i g g a", "negro", "negroes", "negroid",
    "darkie", "darky", "coon", "coons", "jigaboo", "pickaninny", "sambo", "uncle tom",
    "cotton picker", "monkey boy", "porch monkey", "tar baby", "moon cricket",
    "spear chucker", "wetback", "wetbacks", "beaner", "beaners", "spic", "spics",
    "cholo", "taco bender", "border hopper", "gringo", "cracker", "crackers",
    "redneck", "rednecks", "hillbilly", "white trash", "honky", "honkey", "wigger",
    "wigga", "kike", "kikes", "hymie", "yid", "heeb", "jewboy", "zyklon",
    "chink", "chinks", "chinky", "ching chong", "chingchong", "gook", "gooks",
    "zip", "jap", "japs", "nip", "nips", "slant eye", "zipperhead", "towelhead",
    "towel head", "raghead", "rag head", "sand nigger", "camel jockey", "paki",
    "pakis", "curry muncher", "abo", "aborigine", "gyppo", "gipsy", "gypsy",
    "pikey", "polack", "kraut", "hun", "boche", "wop", "wops", "dago", "guinea",
    "frog", "ruskie", "ruski", "commie", "commies", "sovok",
    "faggot", "faggots", "fag", "fags", "faggit", "f@ggot", "f a g g o t",
    "fagot", "faghead", "fagtard", "dyke", "dykes", "bulldyke", "butch", "batty boy",
    "fudge packer", "pillow biter", "bum boy", "queer", "tranny", "trannies",
    "shemale", "she-male", "ladyboy", "trap", "shim", "he-she", "sissy", "poof",
    "poofter", "sodomite", "degenerate", "degenerates", "cuck", "cuckold", "cuckolds",
    "cuckolded", "cucking", "simpcuck", "soyboy", "beta male", "incel", "incels",
    "femcel", "femcels", "neckbeard", "simp", "simping", "simps", "thot", "thots",
    "whore", "whores", "whoring", "ho", "hoe", "hoes", "skank", "skanks", "skanky",
    "slut", "sluts", "slutty", "slutbag", "hooker", "hookers", "prosti", "prostitute",
    "prostitutes", "escort", "pimp", "pimps", "pimping", "madam", "tramp", "tramps",
    "trollop", "harlot", "harlots", "hussy", "strumpet", "jezebel", "gold digger",
    "golddigger",

    // ── 지능 / 장애 / 정신 질환 비하 ──
    "retard", "retards", "retarded", "retardant", "tard", "tards", "libtard",
    "conservatard", "trumptard", "spastic", "spaz", "mongoloid", "mong", "cretin",
    "idiot", "idiots", "idiotic", "moron", "morons", "moronic", "imbecile", "imbeciles",
    "dumbfuck", "dumb fuck", "dumbshit", "dumb shit", "dummy", "dumb", "dipshit",
    "dimwit", "halfwit", "nitwit", "pinhead", "birdbrain", "pea brain", "knucklehead",
    "meathead", "blockhead", "airhead", "shithead", "numbskull", "numbnuts", "bonehead",
    "fathead", "dunderhead", "doofus", "dingbat", "ignoramus", "simpleton", "ditz",
    "psycho", "lunatic", "psychopath", "sociopath", "psychotic", "schizo", "schizophrenic",
    "bipolar", "autistic", "autism", "autist", "sperg", "aspie", "loony", "nutjob",
    "crackpot", "maniac", "wacko", "weirdo", "freak", "freakshow", "creep", "creeper",
    "pervert", "perverts", "perv", "pervy", "peeping tom", "flasher", "molest", "molester",
    "child molester", "pedo", "pedos", "pedophile", "pedophiles", "paedophile", "nonse",
    "nonces", "epstein", "groomer", "grooming", "rapist", "rapists", "rape", "raping",
    "raped", "date rape", "statutory rape", "necrophile", "necrophilia", "bestiality",
    "zoophile",

    // ═════════════════════════════════════════════════════════════════
    // 14. 영어 - 폭력 / 살인 / 자해 / 협박 / 극단주의 (English Violence, Threats, Death & Extremism)
    // ═════════════════════════════════════════════════════════════════
    "kill yourself", "kys", "kill urself", "commit suicide", "go die", "go kill yourself",
    "hope you die", "die in a fire", "hang yourself", "neck yourself", "drink bleach",
    "slit your wrists", "jump off a bridge", "shoot yourself", "put a bullet in your head",
    "end your life", "take your own life", "suicide", "suicidal", "murder", "murderer",
    "homicidal", "mass shooting", "school shooter", "terrorist", "terrorism", "decapitate",
    "decapitation", "behead", "beheading", "execution", "slaughter", "massacre", "lynching",
    "gas chamber", "swastika", "heil hitler", "sieg heil", "nazi", "nazis", "neo-nazi",
    "kkk", "ku klux klan", "white power", "white supremacy", "blood and soil", "1488",
    "hitler", "holocaust", "jihad", "suicide bomber", "isis", "al qaeda", "bomb threat",
    "death threat", "swatting", "doxxing", "doxx", "doxing", "acid attack", "stab",
    "stabbing", "gouge", "mutilate", "mutilation", "castration", "castrate", "torture",
    "waterboarding", "choke", "strangle", "asphyxiate", "suffocate", "drown", "burn alive",
    "flay", "skin alive",

    // ═════════════════════════════════════════════════════════════════
    // 15. 영어 - 인터넷 약어 / 은어 / 모욕 표현 (English Acronyms & Online Slang)
    // ═════════════════════════════════════════════════════════════════
    "gtfo", "ffs", "pos", "milf", "dilf", "gilf", "dtf", "nsfw", "fubar", "snafu",
    "bfd", "ffak", "roflmao", "lmfao", "tfw", "chad", "virgin", "boomer", "doomer",
    "bloomer", "zoomer", "coomer", "sneed", "cope", "seethe", "dilate", "mald",
    "rent free", "touch grass", "l+ratio", "skill issue", "touchgrass", "roping",
    "rope yourself", "an hero", "hero yourself", "facepalm", "snowflake", "feminazi",
    "cuckservative", "alt-right", "bootlicker", "acab", "1312",

    "뒈져", "뒈져라", "뒈질",
    "자살해", "자살해라", "자살하세요",
    "자살하셔", "자살각",
    "칼빵", "칼빵맞", "찔러", "찔러버려",
    "시체놈", "시체년",
    "목매달", "목메달",

    // ── 파생 변형/은어 ──
    "씨발련", "시발련", "씨발놈", "시발놈",
    "시방새", "씨방새", "씨방놈", "시방놈",
    "쌍놈", "쌍년", "쌍새끼",
    "개자식", "개자슥",
    "개년", "개놈", "개년아", "개놈아",
    "개좆", "개보지", "개자지",
    "개씹", "개미친",
    "쓰레기새끼", "쓰레기같",
    "니미럴", "니미랄", "니미씹",
    "슈벌", "슈발",
    "시부레", "씨부레", "시부리", "씨부리",
    "뻐큐", "빠큐", "뻑큐",
    "야발", "아발",
    "씹창", "씹창나",
    "개꼴", "개꼴됐",
    "잡것", "잡놈", "잡년", "잡새끼",
    "썅년", "썅놈",
    "개구라", "눈깔", "주둥이", "주댕이", "주둥아리",
    "아가리", "아가리해", "아가리닥",
    "존나", "졸라", "존내", "졸래",
    "빡대가리", "빡대갈",
    "멍청이", "멍청한", "멍청아",
    "바보새끼", "바보같은놈", "바보같은년",
    "한심한", "한심한새끼", "한심한놈", "한심한년",
    "쓸모없", "못난이",
    "호로새끼", "호로자식", "호로놈", "호로년",
    "머저리", "머저리새끼",
    "간나새끼", "간나년",
    "유사강간",

    // ── 신조어/인터넷 은어 ──
    "ㅈ같", "ㅈ까", "ㅈ밥", "ㅈ대",
    "ㅆㄹ", "ㅄㅋ", "ㅂㅅㅋ",
    "시1발", "씨1발", "시2발", "씨2발",
    "s발", "c발", "si발", "ssi발",
    "ㅅ발", "ㅆ발",
    "tl발", "tlqkf",
    "시바라마", "씨발라마",
    "띠발", "퓨씨", "퍽큐",
    "패륜", "패륜아", "패륜녀", "패륜남",
    "쉬벌", "쒸벌", "쓔벌",
    "씨발롬", "시발롬",
    "쪼다", "쪼다새끼",
    "꼬봉", "꼬봉새끼",
    "조빠", "쪼빠",
    "개한민국", "헬조센", "헬조선",
    "니미새끼", "늬미새끼",

    // -- 사용자 추가 --
    "고려장",
]);