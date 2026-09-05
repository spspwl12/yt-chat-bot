// ─── weather.js ──────────────────────────────────────────────────────────────
// 실시간 전국 날씨 및 전국 모든 지역(시/군/구) 날씨 조회 모듈
// 사용법:
//   - !날씨         → 전국 주요 도시 (서울, 강릉, 대전, 대구, 광주, 부산, 제주) 날씨 요약 + 일출/일몰 시간
//   - !날씨 [지역]  → 전국 모든 지역 상세 조회 및 해당 지역 일출/일몰 시간 (예: !날씨 수원, !날씨 서귀포, !날씨 독도)
// ─────────────────────────────────────────────────────────────────────────────

const msg = require('../../data/config-messages.js');

// 전국 요약에 표시할 기본 도시 순서 (변경 금지)
const NATIONAL_CITIES = ['서울', '강릉', '대전', '대구', '광주', '부산', '제주'];

// 전국 모든 행정구역 (특별시/광역시/특별자치시/도 및 전국의 모든 시·군·구, 주요 도서/읍면) 위도/경도 테이블
const CITY_COORDS = {
    // ─── 전국 주요 거점 ───
    '서울': { lat: 37.5665, lon: 126.9780, name: '서울' },
    '강릉': { lat: 37.7556, lon: 128.8961, name: '강릉' },
    '대전': { lat: 36.3504, lon: 127.3845, name: '대전' },
    '대구': { lat: 35.8714, lon: 128.6014, name: '대구' },
    '광주': { lat: 35.1595, lon: 126.8526, name: '광주' },
    '부산': { lat: 35.1796, lon: 129.0756, name: '부산' },
    '제주': { lat: 33.4996, lon: 126.5312, name: '제주' },

    // ─── 특별시 / 광역시 / 특별자치시 ───
    '인천': { lat: 37.4563, lon: 126.7052, name: '인천' },
    '울산': { lat: 35.5384, lon: 129.3114, name: '울산' },
    '세종': { lat: 36.4800, lon: 127.2890, name: '세종' },

    // ─── 서울특별시 25개 자치구 ───
    '강남': { lat: 37.5172, lon: 127.0473, name: '강남' },
    '강동': { lat: 37.5301, lon: 127.1238, name: '강동' },
    '강북': { lat: 37.6396, lon: 127.0257, name: '강북' },
    '강서': { lat: 37.5509, lon: 126.8495, name: '강서' },
    '관악': { lat: 37.4784, lon: 126.9516, name: '관악' },
    '광진': { lat: 37.5385, lon: 127.0824, name: '광진' },
    '구로': { lat: 37.4954, lon: 126.8874, name: '구로' },
    '금천': { lat: 37.4568, lon: 126.8954, name: '금천' },
    '노원': { lat: 37.6542, lon: 127.0568, name: '노원' },
    '도봉': { lat: 37.6688, lon: 127.0471, name: '도봉' },
    '동대문': { lat: 37.5744, lon: 127.0396, name: '동대문' },
    '동작': { lat: 37.5124, lon: 126.9393, name: '동작' },
    '마포': { lat: 37.5663, lon: 126.9016, name: '마포' },
    '서대문': { lat: 37.5791, lon: 126.9368, name: '서대문' },
    '서초': { lat: 37.4837, lon: 127.0324, name: '서초' },
    '성동': { lat: 37.5633, lon: 127.0371, name: '성동' },
    '성북': { lat: 37.5891, lon: 127.0182, name: '성북' },
    '송파': { lat: 37.5145, lon: 127.1059, name: '송파' },
    '양천': { lat: 37.5169, lon: 126.8665, name: '양천' },
    '영등포': { lat: 37.5264, lon: 126.8962, name: '영등포' },
    '용산': { lat: 37.5326, lon: 126.9900, name: '용산' },
    '은평': { lat: 37.6027, lon: 126.9291, name: '은평' },
    '종로': { lat: 37.5730, lon: 126.9794, name: '종로' },
    '중구': { lat: 37.5638, lon: 126.9976, name: '중구' },
    '중랑': { lat: 37.6066, lon: 127.0927, name: '중랑' },

    // ─── 경기도 31개 시·군 및 주요 구 ───
    '수원': { lat: 37.2636, lon: 127.0286, name: '수원' },
    '성남': { lat: 37.4200, lon: 127.1265, name: '성남' },
    '분당': { lat: 37.3827, lon: 127.1189, name: '분당' },
    '고양': { lat: 37.6584, lon: 126.8320, name: '고양' },
    '일산': { lat: 37.6582, lon: 126.7701, name: '일산' },
    '용인': { lat: 37.2411, lon: 127.1776, name: '용인' },
    '수지': { lat: 37.3223, lon: 127.0975, name: '수지' },
    '기흥': { lat: 37.2804, lon: 127.1147, name: '기흥' },
    '부천': { lat: 37.5034, lon: 126.7660, name: '부천' },
    '안산': { lat: 37.3219, lon: 126.8309, name: '안산' },
    '안양': { lat: 37.3943, lon: 126.9568, name: '안양' },
    '평택': { lat: 36.9921, lon: 127.1129, name: '평택' },
    '시흥': { lat: 37.3802, lon: 126.8029, name: '시흥' },
    '화성': { lat: 37.1995, lon: 126.8315, name: '화성' },
    '동탄': { lat: 37.2002, lon: 127.0744, name: '동탄' },
    '의정부': { lat: 37.7381, lon: 127.0337, name: '의정부' },
    '파주': { lat: 37.7600, lon: 126.7799, name: '파주' },
    '김포': { lat: 37.6153, lon: 126.7155, name: '김포' },
    '구리': { lat: 37.5943, lon: 127.1296, name: '구리' },
    '남양주': { lat: 37.6360, lon: 127.2165, name: '남양주' },
    '광명': { lat: 37.4786, lon: 126.8647, name: '광명' },
    '군포': { lat: 37.3614, lon: 126.9352, name: '군포' },
    '이천': { lat: 37.2723, lon: 127.4350, name: '이천' },
    '오산': { lat: 37.1498, lon: 127.0772, name: '오산' },
    '하남': { lat: 37.5393, lon: 127.2148, name: '하남' },
    '양주': { lat: 37.7853, lon: 127.0458, name: '양주' },
    '안성': { lat: 37.0080, lon: 127.2797, name: '안성' },
    '포천': { lat: 37.8949, lon: 127.2003, name: '포천' },
    '의왕': { lat: 37.3448, lon: 126.9683, name: '의왕' },
    '여주': { lat: 37.2983, lon: 127.6370, name: '여주' },
    '양평': { lat: 37.4917, lon: 127.4876, name: '양평' },
    '동두천': { lat: 37.9036, lon: 127.0607, name: '동두천' },
    '과천': { lat: 37.4292, lon: 126.9876, name: '과천' },
    '가평': { lat: 37.8315, lon: 127.5095, name: '가평' },
    '연천': { lat: 38.0964, lon: 127.0749, name: '연천' },

    // ─── 강원특별자치도 18개 시·군 ───
    '춘천': { lat: 37.8813, lon: 127.7298, name: '춘천' },
    '원주': { lat: 37.3422, lon: 127.9202, name: '원주' },
    '동해': { lat: 37.5247, lon: 129.1143, name: '동해' },
    '태백': { lat: 37.1641, lon: 128.9856, name: '태백' },
    '속초': { lat: 38.2070, lon: 128.5918, name: '속초' },
    '삼척': { lat: 37.4499, lon: 129.1653, name: '삼척' },
    '홍천': { lat: 37.6972, lon: 127.8887, name: '홍천' },
    '횡성': { lat: 37.4918, lon: 127.9850, name: '횡성' },
    '영월': { lat: 37.1837, lon: 128.4619, name: '영월' },
    '평창': { lat: 37.3705, lon: 128.3902, name: '평창' },
    '정선': { lat: 37.3806, lon: 128.6608, name: '정선' },
    '철원': { lat: 38.1468, lon: 127.3134, name: '철원' },
    '화천': { lat: 38.1062, lon: 127.7082, name: '화천' },
    '양구': { lat: 38.1095, lon: 127.9897, name: '양구' },
    '인제': { lat: 38.0697, lon: 128.1704, name: '인제' },
    '고성(강원)': { lat: 38.3806, lon: 128.4678, name: '고성(강원)' },
    '양양': { lat: 38.0754, lon: 128.6189, name: '양양' },

    // ─── 충청북도 11개 시·군 ───
    '청주': { lat: 36.6424, lon: 127.4890, name: '청주' },
    '충주': { lat: 36.9910, lon: 127.9260, name: '충주' },
    '제천': { lat: 37.1326, lon: 128.2117, name: '제천' },
    '보은': { lat: 36.4894, lon: 127.7340, name: '보은' },
    '옥천': { lat: 36.3065, lon: 127.5714, name: '옥천' },
    '영동': { lat: 36.1750, lon: 127.7836, name: '영동' },
    '증평': { lat: 36.7853, lon: 127.5815, name: '증평' },
    '진천': { lat: 36.8554, lon: 127.4432, name: '진천' },
    '괴산': { lat: 36.8153, lon: 127.7868, name: '괴산' },
    '음성': { lat: 36.9341, lon: 127.6906, name: '음성' },
    '단양': { lat: 36.9845, lon: 128.3656, name: '단양' },

    // ─── 충청남도 15개 시·군 ───
    '천안': { lat: 36.8151, lon: 127.1139, name: '천안' },
    '공주': { lat: 36.4465, lon: 127.1190, name: '공주' },
    '보령': { lat: 36.3330, lon: 126.6129, name: '보령' },
    '아산': { lat: 36.7898, lon: 127.0019, name: '아산' },
    '서산': { lat: 36.7845, lon: 126.4503, name: '서산' },
    '논산': { lat: 36.1872, lon: 127.0987, name: '논산' },
    '계룡': { lat: 36.2743, lon: 127.2486, name: '계룡' },
    '당진': { lat: 36.8899, lon: 126.6459, name: '당진' },
    '금산': { lat: 36.1087, lon: 127.4881, name: '금산' },
    '부여': { lat: 36.2756, lon: 126.9098, name: '부여' },
    '서천': { lat: 36.0803, lon: 126.6914, name: '서천' },
    '청양': { lat: 36.4590, lon: 126.8040, name: '청양' },
    '홍성': { lat: 36.6013, lon: 126.6608, name: '홍성' },
    '예산': { lat: 36.6800, lon: 126.8450, name: '예산' },
    '태안': { lat: 36.7456, lon: 126.2979, name: '태안' },
    '안면도': { lat: 36.5204, lon: 126.3468, name: '안면도' },

    // ─── 전북특별자치도 14개 시·군 ───
    '전주': { lat: 35.8242, lon: 127.1480, name: '전주' },
    '군산': { lat: 35.9676, lon: 126.7366, name: '군산' },
    '익산': { lat: 35.9483, lon: 126.9576, name: '익산' },
    '정읍': { lat: 35.5699, lon: 126.8577, name: '정읍' },
    '남원': { lat: 35.4164, lon: 127.3905, name: '남원' },
    '김제': { lat: 35.8036, lon: 126.8809, name: '김제' },
    '완주': { lat: 35.9048, lon: 127.1625, name: '완주' },
    '진안': { lat: 35.7917, lon: 127.4248, name: '진안' },
    '무주': { lat: 36.0068, lon: 127.6609, name: '무주' },
    '장수': { lat: 35.6474, lon: 127.5215, name: '장수' },
    '임실': { lat: 35.6178, lon: 127.2798, name: '임실' },
    '순창': { lat: 35.3744, lon: 127.1378, name: '순창' },
    '고창': { lat: 35.4358, lon: 126.7021, name: '고창' },
    '부안': { lat: 35.7317, lon: 126.7334, name: '부안' },

    // ─── 전라남도 22개 시·군 및 주요 도서 ───
    '목포': { lat: 34.8118, lon: 126.3922, name: '목포' },
    '여수': { lat: 34.7604, lon: 127.6622, name: '여수' },
    '순천': { lat: 34.9507, lon: 127.4872, name: '순천' },
    '나주': { lat: 35.0161, lon: 126.7108, name: '나주' },
    '광양': { lat: 34.9407, lon: 127.6959, name: '광양' },
    '담양': { lat: 35.3211, lon: 126.9882, name: '담양' },
    '곡성': { lat: 35.2820, lon: 127.2919, name: '곡성' },
    '구례': { lat: 35.2025, lon: 127.4627, name: '구례' },
    '고흥': { lat: 34.6111, lon: 127.2859, name: '고흥' },
    '보성': { lat: 34.7715, lon: 127.0799, name: '보성' },
    '화순': { lat: 35.0645, lon: 126.9866, name: '화순' },
    '장흥': { lat: 34.6815, lon: 126.9070, name: '장흥' },
    '강진': { lat: 34.6421, lon: 126.7672, name: '강진' },
    '해남': { lat: 34.5735, lon: 126.5989, name: '해남' },
    '영암': { lat: 34.8001, lon: 126.6968, name: '영암' },
    '무안': { lat: 34.9904, lon: 126.4817, name: '무안' },
    '함평': { lat: 35.0657, lon: 126.5165, name: '함평' },
    '영광': { lat: 35.2773, lon: 126.5120, name: '영광' },
    '장성': { lat: 35.3015, lon: 126.7846, name: '장성' },
    '완도': { lat: 34.3111, lon: 126.7550, name: '완도' },
    '진도': { lat: 34.4868, lon: 126.2634, name: '진도' },
    '신안': { lat: 34.8336, lon: 126.3512, name: '신안' },
    '흑산도': { lat: 34.6841, lon: 125.4384, name: '흑산도' },

    // ─── 경상북도 22개 시·군 및 도서 ───
    '포항': { lat: 36.0190, lon: 129.3435, name: '포항' },
    '경주': { lat: 35.8562, lon: 129.2247, name: '경주' },
    '김천': { lat: 36.1398, lon: 128.1136, name: '김천' },
    '안동': { lat: 36.5684, lon: 128.7294, name: '안동' },
    '구미': { lat: 36.1195, lon: 128.3446, name: '구미' },
    '영주': { lat: 36.8057, lon: 128.6241, name: '영주' },
    '영천': { lat: 35.9733, lon: 128.9385, name: '영천' },
    '상주': { lat: 36.4109, lon: 128.1591, name: '상주' },
    '문경': { lat: 36.5938, lon: 128.1867, name: '문경' },
    '경산': { lat: 35.8251, lon: 128.7414, name: '경산' },
    '의성': { lat: 36.3526, lon: 128.6971, name: '의성' },
    '청송': { lat: 36.4357, lon: 129.0573, name: '청송' },
    '영양': { lat: 36.6667, lon: 129.1124, name: '영양' },
    '영덕': { lat: 36.4150, lon: 129.3656, name: '영덕' },
    '청도': { lat: 35.6474, lon: 128.7340, name: '청도' },
    '고령': { lat: 35.7258, lon: 128.2629, name: '고령' },
    '성주': { lat: 35.9195, lon: 128.2831, name: '성주' },
    '칠곡': { lat: 35.9956, lon: 128.4017, name: '칠곡' },
    '예천': { lat: 36.6574, lon: 128.4528, name: '예천' },
    '봉화': { lat: 36.8930, lon: 128.7325, name: '봉화' },
    '울진': { lat: 36.9931, lon: 129.4003, name: '울진' },
    '울릉': { lat: 37.4844, lon: 130.9057, name: '울릉도' },
    '울릉도': { lat: 37.4844, lon: 130.9057, name: '울릉도' },
    '독도': { lat: 37.2428, lon: 131.8686, name: '독도' },

    // ─── 경상남도 18개 시·군 및 주요 구 ───
    '창원': { lat: 35.2280, lon: 128.6811, name: '창원' },
    '마산': { lat: 35.2052, lon: 128.5786, name: '마산' },
    '진해': { lat: 35.1494, lon: 128.6631, name: '진해' },
    '진주': { lat: 35.1802, lon: 128.1076, name: '진주' },
    '통영': { lat: 34.8544, lon: 128.4332, name: '통영' },
    '사천': { lat: 35.0036, lon: 128.0642, name: '사천' },
    '김해': { lat: 35.2285, lon: 128.8894, name: '김해' },
    '밀양': { lat: 35.5038, lon: 128.7466, name: '밀양' },
    '거제': { lat: 34.8806, lon: 128.6211, name: '거제' },
    '거제도': { lat: 34.8806, lon: 128.6211, name: '거제도' },
    '양산': { lat: 35.3350, lon: 129.0373, name: '양산' },
    '의령': { lat: 35.3223, lon: 128.2619, name: '의령' },
    '함안': { lat: 35.2725, lon: 128.4065, name: '함안' },
    '창녕': { lat: 35.5414, lon: 128.4922, name: '창녕' },
    '고성(경남)': { lat: 34.9757, lon: 128.3235, name: '고성(경남)' },
    '남해': { lat: 34.8377, lon: 127.8924, name: '남해' },
    '하동': { lat: 35.0673, lon: 127.7513, name: '하동' },
    '산청': { lat: 35.4154, lon: 127.8735, name: '산청' },
    '함양': { lat: 35.5205, lon: 127.7252, name: '함양' },
    '거창': { lat: 35.6866, lon: 127.9095, name: '거창' },
    '합천': { lat: 35.5667, lon: 128.1658, name: '합천' },

    // ─── 제주특별자치도 및 도서 ───
    '서귀포': { lat: 33.2541, lon: 126.5601, name: '서귀포' },
    '서귀포시': { lat: 33.2541, lon: 126.5601, name: '서귀포' },
    '성산': { lat: 33.4623, lon: 126.9356, name: '성산' },
    '중문': { lat: 33.2514, lon: 126.4255, name: '중문' },
    '한림': { lat: 33.4144, lon: 126.2625, name: '한림' },
    '마라도': { lat: 33.1186, lon: 126.2694, name: '마라도' },

    // ─── 서해 5도 및 주요 도서 ───
    '백령도': { lat: 37.9712, lon: 124.6305, name: '백령도' },
    '연평도': { lat: 37.6698, lon: 125.7003, name: '연평도' },
    '강화': { lat: 37.7464, lon: 126.4880, name: '강화도' },
    '강화도': { lat: 37.7464, lon: 126.4880, name: '강화도' },

    // ─── 대전/세종/충청 주요 생활권 및 읍·면·동 ───
    '신탄진': { lat: 36.4503, lon: 127.4290, name: '신탄진' },
    '유성': { lat: 36.3622, lon: 127.3563, name: '유성' },
    '유성온천': { lat: 36.3537, lon: 127.3421, name: '유성' },
    '둔산': { lat: 36.3551, lon: 127.3837, name: '둔산' },
    '대덕': { lat: 36.3466, lon: 127.4156, name: '대덕' },
    '조치원': { lat: 36.6044, lon: 127.2989, name: '조치원' },
    '오창': { lat: 36.7126, lon: 127.4332, name: '오창' },
    '오송': { lat: 36.6198, lon: 127.3270, name: '오송' },
    '대청호': { lat: 36.4780, lon: 127.4800, name: '대청호' },
    '대천': { lat: 36.3533, lon: 126.5168, name: '대천' },
    '온양': { lat: 36.7845, lon: 127.0040, name: '온양' },
    '성환': { lat: 36.9157, lon: 127.1332, name: '성환' },
    '대산': { lat: 36.9388, lon: 126.4315, name: '대산' },
    '삽교': { lat: 36.7323, lon: 126.7812, name: '삽교' },

    // ─── 수도권 주요 신도시/생활권/읍·면·동 ───
    '판교': { lat: 37.3947, lon: 127.1112, name: '판교' },
    '광교': { lat: 37.2889, lon: 127.0519, name: '광교' },
    '위례': { lat: 37.4787, lon: 127.1428, name: '위례' },
    '송도': { lat: 37.3879, lon: 126.6565, name: '송도' },
    '청라': { lat: 37.5348, lon: 126.6548, name: '청라' },
    '영종': { lat: 37.4912, lon: 126.4965, name: '영종도' },
    '영종도': { lat: 37.4912, lon: 126.4965, name: '영종도' },
    '검단': { lat: 37.5976, lon: 126.6756, name: '검단' },
    '배곧': { lat: 37.3695, lon: 126.7265, name: '배곧' },
    '월곶': { lat: 37.3897, lon: 126.7419, name: '월곶' },
    '정왕': { lat: 37.3456, lon: 126.7368, name: '정왕' },
    '대부도': { lat: 37.2341, lon: 126.5898, name: '대부도' },
    '제부도': { lat: 37.1672, lon: 126.6231, name: '제부도' },
    '향남': { lat: 37.1332, lon: 126.9205, name: '향남' },
    '봉담': { lat: 37.2185, lon: 126.9538, name: '봉담' },
    '남양': { lat: 37.2117, lon: 126.8188, name: '남양' },
    '송탄': { lat: 37.0768, lon: 127.0548, name: '송탄' },
    '안중': { lat: 36.9868, lon: 126.9287, name: '안중' },
    '포승': { lat: 36.9882, lon: 126.8687, name: '포승' },
    '팽성': { lat: 36.9632, lon: 127.0587, name: '팽성' },
    '운정': { lat: 37.7289, lon: 126.7578, name: '운정' },
    '문산': { lat: 37.8589, lon: 126.7842, name: '문산' },
    '판문점': { lat: 37.9560, lon: 126.6769, name: '판문점' },
    '임진각': { lat: 37.8895, lon: 126.7415, name: '임진각' },
    '별내': { lat: 37.6432, lon: 127.1189, name: '별내' },
    '다산': { lat: 37.6087, lon: 127.1587, name: '다산' },
    '진접': { lat: 37.7123, lon: 127.1856, name: '진접' },
    '화도': { lat: 37.6534, lon: 127.3065, name: '화도' },
    '마석': { lat: 37.6534, lon: 127.3065, name: '마석' },
    '옥정': { lat: 37.8189, lon: 127.0856, name: '옥정' },
    '통진': { lat: 37.6889, lon: 126.5923, name: '통진' },
    '양촌': { lat: 37.6489, lon: 126.6387, name: '양촌' },
    '구래': { lat: 37.6468, lon: 126.6289, name: '구래' },
    '장기': { lat: 37.6468, lon: 126.6756, name: '장기' },
    '풍무': { lat: 37.6012, lon: 126.7265, name: '풍무' },
    '여의도': { lat: 37.5215, lon: 126.9242, name: '여의도' },
    '잠실': { lat: 37.5133, lon: 127.1001, name: '잠실' },
    '홍대': { lat: 37.5563, lon: 126.9224, name: '홍대' },
    '신촌': { lat: 37.5552, lon: 126.9368, name: '신촌' },
    '명동': { lat: 37.5636, lon: 126.9827, name: '명동' },
    '압구정': { lat: 37.5270, lon: 127.0284, name: '압구정' },
    '청담': { lat: 37.5245, lon: 127.0498, name: '청담' },
    '이태원': { lat: 37.5345, lon: 126.9942, name: '이태원' },
    '성수': { lat: 37.5446, lon: 127.0558, name: '성수' },

    // ─── 영남권 주요 생활권/읍·면·동/명소 ───
    '해운대': { lat: 35.1631, lon: 129.1636, name: '해운대' },
    '광안리': { lat: 35.1532, lon: 129.1189, name: '광안리' },
    '서면': { lat: 35.1578, lon: 129.0592, name: '서면' },
    '남포동': { lat: 35.0978, lon: 129.0305, name: '남포동' },
    '자갈치': { lat: 35.0965, lon: 129.0289, name: '자갈치' },
    '기장': { lat: 35.2447, lon: 129.2223, name: '기장' },
    '정관': { lat: 35.3212, lon: 129.1789, name: '정관' },
    '동래': { lat: 35.2052, lon: 129.0837, name: '동래' },
    '사상': { lat: 35.1528, lon: 128.9912, name: '사상' },
    '다대포': { lat: 35.0489, lon: 128.9654, name: '다대포' },
    '수성': { lat: 35.8583, lon: 128.6306, name: '수성' },
    '달서': { lat: 35.8298, lon: 128.5326, name: '달서' },
    '동촌': { lat: 35.8856, lon: 128.6654, name: '동촌' },
    '왜관': { lat: 35.9923, lon: 128.3987, name: '왜관' },
    '하양': { lat: 35.9123, lon: 128.8187, name: '하양' },
    '안강': { lat: 35.9912, lon: 129.2387, name: '안강' },
    '감포': { lat: 35.8012, lon: 129.5023, name: '감포' },
    '구룡포': { lat: 35.9912, lon: 129.5587, name: '구룡포' },
    '호미곶': { lat: 36.0789, lon: 129.5687, name: '호미곶' },
    '장유': { lat: 35.1889, lon: 128.8023, name: '장유' },
    '진영': { lat: 35.3123, lon: 128.7387, name: '진영' },
    '삼천포': { lat: 34.9312, lon: 128.0687, name: '삼천포' },
    '지리산': { lat: 35.3369, lon: 127.7306, name: '지리산' },

    // ─── 호남권 주요 생활권/읍·면·동/명소 ───
    '상무': { lat: 35.1523, lon: 126.8523, name: '상무' },
    '상무지구': { lat: 35.1523, lon: 126.8523, name: '상무' },
    '수완': { lat: 35.1912, lon: 126.8212, name: '수완' },
    '첨단': { lat: 35.2189, lon: 126.8456, name: '첨단' },
    '송정': { lat: 35.1387, lon: 126.7912, name: '송정' },
    '빛가람': { lat: 35.0289, lon: 126.7823, name: '빛가람' },
    '돌산': { lat: 34.6912, lon: 127.7512, name: '돌산' },
    '거문도': { lat: 34.0289, lon: 127.3112, name: '거문도' },
    '홍도': { lat: 34.6889, lon: 125.1912, name: '홍도' },
    '선유도': { lat: 35.8112, lon: 126.4187, name: '선유도' },
    '격포': { lat: 35.6289, lon: 126.4687, name: '격포' },
    '변산': { lat: 35.6812, lon: 126.5412, name: '변산' },

    // ─── 강원권 주요 생활권/읍·면·동/명소 ───
    '대관령': { lat: 37.6778, lon: 128.7187, name: '대관령' },
    '설악산': { lat: 38.1189, lon: 128.4654, name: '설악산' },
    '오대산': { lat: 37.7989, lon: 128.5412, name: '오대산' },
    '태백산': { lat: 37.0989, lon: 128.9187, name: '태백산' },
    '치악산': { lat: 37.3689, lon: 128.0512, name: '치악산' },
    '경포대': { lat: 37.7989, lon: 128.8987, name: '경포대' },
    '주문진': { lat: 37.8912, lon: 128.8287, name: '주문진' },
    '정동진': { lat: 37.6912, lon: 129.0312, name: '정동진' },
    '간성': { lat: 38.3812, lon: 128.4712, name: '간성' },
    '거진': { lat: 38.4412, lon: 128.4587, name: '거진' },
    '묵호': { lat: 37.5512, lon: 129.1187, name: '묵호' },

    // ─── 제주 주요 생활권/읍·면·동/명소 ───
    '애월': { lat: 33.4623, lon: 126.3312, name: '애월' },
    '구좌': { lat: 33.5212, lon: 126.8512, name: '구좌' },
    '조천': { lat: 33.5389, lon: 126.6387, name: '조천' },
    '표선': { lat: 33.3289, lon: 126.8312, name: '표선' },
    '남원(제주)': { lat: 33.2789, lon: 126.7187, name: '남원(제주)' },
    '안덕': { lat: 33.2512, lon: 126.3312, name: '안덕' },
    '대정': { lat: 33.2289, lon: 126.2512, name: '대정' },
    '모슬포': { lat: 33.2189, lon: 126.2512, name: '모슬포' },
    '우도': { lat: 33.5012, lon: 126.9512, name: '우도' },
    '추자도': { lat: 33.9589, lon: 126.2987, name: '추자도' },
    '한라산': { lat: 33.3617, lon: 126.5350, name: '한라산' }
};

/**
 * Hinode (https://hinode.pics/lang/ko/maps/sun) 알고리즘 기반 일출/일몰 시간 계산
 * (외부 웹 API 호출 없이 위도/경도/날짜/시차 기반 천문 계산 공식으로 순수 로컬 계산)
 * @param {number} lat 위도 (도)
 * @param {number} lon 경도 (도)
 * @param {Date} [date] 기준 날짜 (기본값: 현재 시각)
 * @param {number} [timeDifference] 시차 (기본값: 한국 KST = +9)
 * @returns {{ sunrise: string, sunset: string }} 일출/일몰 시간 (HH:mm)
 */
function calculateSunTimes(lat, lon, date = new Date(), timeDifference = 9) {
    const cos = d => Math.cos((d * Math.PI) / 180);
    const sin = d => Math.sin((d * Math.PI) / 180);

    const sun = {
        JD: 0,
        LS: 0,
        DS: 0,
        BS: 0,
        sigma: 0,
        alpha: 0,
        greenwichTheta: 0,
        localTheta: 0,
        h: 0,
        a: 0
    };

    function calcJD(Y, M, D, hh, mm, timeDiff) {
        let y = Y;
        let m = M;
        if (m <= 2) {
            y -= 1;
            m += 12;
        }
        sun.JD = ~~(365.25 * y + ~~(y / 400) - ~~(y / 100)
            + ~~(30.59 * (m - 2)))
            + D + 1721088.5
            + ((hh - timeDiff) / 24)
            + (mm / 1440);
    }

    function calcLS() {
        const T = (sun.JD - 2451545) / 36525;
        const S = 280.4659 + 36000.7695 * T
            + 1.9147 * cos(35999.050 * T + 267.520)
            - 0.0048 * T * cos(35999.050 * T + 267.520)
            + 0.0200 * cos(71998.1 * T + 265.1)
            + 0.0020 * cos(32964 * T + 158)
            + 0.0018 * cos(19 * T + 159)
            + 0.0018 * cos(445267 * T + 208)
            + 0.0015 * cos(45038 * T + 254)
            + 0.0013 * cos(22519 * T + 352)
            + 0.0007 * cos(65929 * T + 45)
            + 0.0007 * cos(3035 * T + 110)
            + 0.0007 * cos(9038 * T + 64)
            + 0.0006 * cos(33718 * T + 316)
            + 0.0005 * cos(155 * T + 118)
            + 0.0005 * cos(2281 * T + 221)
            + 0.0004 * cos(29930 * T + 48)
            + 0.0004 * cos(31557 * T + 161);
        let WS = S / 360;
        WS = WS - (~~WS) + 1;
        sun.LS = (WS - (~~WS)) * 360;
    }

    function calcDS() {
        const T = (sun.JD - 2451545) / 36525;
        sun.DS = 1.000140 * cos(0 * T + 0)
            + 0.016706 * cos(35999.05 * T + 177.53)
            - 0.000042 * T * cos(35999.05 * T + 177.53)
            + 0.000139 * cos(71998 * T + 175)
            + 0.000031 * cos(445267 * T + 298)
            + 0.000016 * cos(32964 * T + 68)
            + 0.000016 * cos(45038 * T + 164)
            + 0.000005 * cos(22519 * T + 233)
            + 0.000005 * cos(33718 * T + 226);
    }

    function calcSigmaAndAlpha() {
        const T = (sun.JD - 2451545) / 36525;
        const dl = -0.005693 / sun.DS;
        const df = -0.00478 * sin(125.04 - 1934.136 * T) + 0.00037 * sin(200.93 + 72001.539 * T);
        const de = +0.00256 * cos(125.04 - 1934.136 * T) + 0.00016 * cos(200.93 + 72001.539 * T);

        const l = sun.LS + dl + df;
        const b = sun.BS + de * sin(sun.LS);
        const e = 23.43929 - 0.013004 * T + de;

        const A = cos(l);
        const B = sin(l) * cos(e);
        const C = sin(l) * sin(e);

        let alpha = (Math.atan(B / A) * 180) / Math.PI;
        if (A < 0) {
            alpha = alpha + 180;
        }
        sun.sigma = (Math.asin(C) * 180) / Math.PI;
        sun.alpha = alpha;
    }

    function calcGreenwichTheta() {
        const TJD = sun.JD - 2440000.5;
        let greenwichTheta = 0.671262 + 1.0027379094 * TJD;
        greenwichTheta -= Math.floor(greenwichTheta);
        sun.greenwichTheta = 24 * greenwichTheta;
    }

    function calcLocalTheta(longitude) {
        sun.localTheta = sun.greenwichTheta + (longitude / 15);
    }

    function calcH() {
        sun.h = (sun.localTheta * 15) - sun.alpha;
    }

    function calcAltitude(latitude) {
        const altitude = sin(sun.sigma) * sin(latitude) + cos(sun.sigma) * cos(sun.h) * cos(latitude);
        sun.a = parseFloat(((Math.asin(altitude) * 180) / Math.PI).toFixed(3));
    }

    // KST 기준 연, 월, 일
    const kstOffsetMs = timeDifference * 60 * 60 * 1000;
    const utcTime = date.getTime() + (date.getTimezoneOffset() * 60000);
    const kstDate = new Date(utcTime + kstOffsetMs);

    const Y = kstDate.getFullYear();
    const M = kstDate.getMonth() + 1;
    const D = kstDate.getDate();

    const horizon = -0.899; // 대기 굴절 및 태양 시반경 고려한 지평선 고도
    let isRising = false;
    const ret = {
        sunrise: '--:--',
        sunset: '--:--'
    };

    for (let hh = 0; hh < 24; hh++) {
        for (let mm = 0; mm < 60; mm++) {
            calcJD(Y, M, D, hh, mm, timeDifference);
            calcLS();
            calcDS();
            calcSigmaAndAlpha();
            calcGreenwichTheta();
            calcLocalTheta(lon);
            calcH();
            calcAltitude(lat);

            if (sun.a > horizon && !isRising) {
                isRising = true;
                ret.sunrise = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
            }
            if (sun.a < horizon && isRising) {
                ret.sunset = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
                return ret;
            }
        }
    }

    return ret;
}

// ─── 기상청(KMA) 97개 전국 관측소 좌표 테이블 ───
const KMA_STATION_COORDS = {
    '서울': { lat: 37.5714, lon: 126.9658 },
    '북춘천': { lat: 37.9474, lon: 127.7544 },
    '춘천': { lat: 37.9026, lon: 127.7357 },
    '철원': { lat: 38.1479, lon: 127.3042 },
    '동두천': { lat: 37.9019, lon: 127.0607 },
    '파주': { lat: 37.8859, lon: 126.7665 },
    '대관령': { lat: 37.6771, lon: 128.7183 },
    '백령도': { lat: 37.9664, lon: 124.6305 },
    '북강릉': { lat: 37.8046, lon: 128.8554 },
    '강릉': { lat: 37.7515, lon: 128.8910 },
    '동해': { lat: 37.5071, lon: 129.1243 },
    '인천': { lat: 37.4777, lon: 126.6249 },
    '원주': { lat: 37.3375, lon: 127.9466 },
    '울릉도': { lat: 37.4813, lon: 130.8986 },
    '수원': { lat: 37.2575, lon: 126.9830 },
    '영월': { lat: 37.1813, lon: 128.4619 },
    '충주': { lat: 36.9705, lon: 127.9525 },
    '서산': { lat: 36.7726, lon: 126.4930 },
    '울진': { lat: 36.9918, lon: 129.4128 },
    '청주': { lat: 36.6372, lon: 127.4414 },
    '서청주': { lat: 36.6392, lon: 127.4430 },
    '대전': { lat: 36.3720, lon: 127.3721 },
    '추풍령': { lat: 36.2203, lon: 127.9946 },
    '안동': { lat: 36.5729, lon: 128.7073 },
    '상주': { lat: 36.4084, lon: 128.1574 },
    '포항': { lat: 36.0327, lon: 129.3797 },
    '군산': { lat: 35.9897, lon: 126.7598 },
    '대구': { lat: 35.8779, lon: 128.6530 },
    '전주': { lat: 35.8409, lon: 127.1172 },
    '울산': { lat: 35.5824, lon: 129.3347 },
    '창원': { lat: 35.1702, lon: 128.6732 },
    '북창원': { lat: 35.2289, lon: 128.6812 },
    '광주': { lat: 35.1729, lon: 126.8916 },
    '부산': { lat: 35.1047, lon: 129.0320 },
    '북부산': { lat: 35.2089, lon: 129.0012 },
    '통영': { lat: 34.8454, lon: 128.4356 },
    '목포': { lat: 34.8171, lon: 126.3812 },
    '여수': { lat: 34.7393, lon: 127.7406 },
    '흑산도': { lat: 34.6872, lon: 125.4514 },
    '완도': { lat: 34.3975, lon: 126.7000 },
    '고창': { lat: 35.4264, lon: 126.6970 },
    '순천': { lat: 34.9434, lon: 127.4859 },
    '홍성': { lat: 36.6578, lon: 126.6875 },
    '제주': { lat: 33.5141, lon: 126.5297 },
    '고산': { lat: 33.2938, lon: 126.1628 },
    '성산': { lat: 33.3868, lon: 126.8804 },
    '서귀포': { lat: 33.2462, lon: 126.5653 },
    '진주': { lat: 35.1638, lon: 128.1076 },
    '강화': { lat: 37.7074, lon: 126.4463 },
    '양평': { lat: 37.4886, lon: 127.4945 },
    '이천': { lat: 37.2640, lon: 127.4842 },
    '인제': { lat: 38.0597, lon: 128.1673 },
    '홍천': { lat: 37.6837, lon: 127.8804 },
    '태백': { lat: 37.1705, lon: 128.9889 },
    '정선군': { lat: 37.3806, lon: 128.6608 },
    '제천': { lat: 37.1593, lon: 128.1943 },
    '보은': { lat: 36.4877, lon: 127.7342 },
    '천안': { lat: 36.7615, lon: 127.1214 },
    '보령': { lat: 36.3269, lon: 126.5574 },
    '부여': { lat: 36.2724, lon: 126.9210 },
    '금산': { lat: 36.1065, lon: 127.4862 },
    '세종': { lat: 36.5332, lon: 127.2917 },
    '부안': { lat: 35.7297, lon: 126.7163 },
    '임실': { lat: 35.6120, lon: 127.2847 },
    '정읍': { lat: 35.5638, lon: 126.8659 },
    '남원': { lat: 35.4054, lon: 127.3860 },
    '장수': { lat: 35.6474, lon: 127.5214 },
    '고창군': { lat: 35.4264, lon: 126.6970 },
    '영광군': { lat: 35.2773, lon: 126.5120 },
    '김해시': { lat: 35.2285, lon: 128.8894 },
    '순창군': { lat: 35.3744, lon: 127.1415 },
    '양산시': { lat: 35.3456, lon: 129.0378 },
    '보성군': { lat: 34.7715, lon: 127.0798 },
    '강진군': { lat: 34.6409, lon: 126.7699 },
    '장흥': { lat: 34.6817, lon: 126.9197 },
    '해남': { lat: 34.5538, lon: 126.5696 },
    '고흥': { lat: 34.6183, lon: 127.2847 },
    '의령군': { lat: 35.3224, lon: 128.2618 },
    '함양군': { lat: 35.5205, lon: 127.7252 },
    '광양시': { lat: 34.9407, lon: 127.6959 },
    '진도군': { lat: 34.4754, lon: 126.2635 },
    '봉화': { lat: 36.8938, lon: 128.7408 },
    '영주': { lat: 36.8719, lon: 128.5169 },
    '문경': { lat: 36.6273, lon: 128.1506 },
    '청송군': { lat: 36.4356, lon: 129.0573 },
    '영덕': { lat: 36.5332, lon: 129.3703 },
    '의성': { lat: 36.3561, lon: 128.6886 },
    '구미': { lat: 36.1305, lon: 128.3206 },
    '영천': { lat: 35.9774, lon: 128.9514 },
    '경주시': { lat: 35.8398, lon: 129.2137 },
    '거창': { lat: 35.6675, lon: 127.9097 },
    '합천': { lat: 35.5651, lon: 128.1699 },
    '밀양': { lat: 35.4915, lon: 128.7441 },
    '산청': { lat: 35.4154, lon: 127.8732 },
    '거제': { lat: 34.8882, lon: 128.6045 },
    '남해': { lat: 34.8166, lon: 127.9264 },
    '속초': { lat: 38.2509, lon: 128.5647 },
};

function getDistance(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 6371;
}

function findNearestKmaStation(lat, lon) {
    let nearest = null;
    let minDist = Infinity;
    for (const [stnName, coord] of Object.entries(KMA_STATION_COORDS)) {
        const dist = getDistance(lat, lon, coord.lat, coord.lon);
        if (dist < minDist) {
            minDist = dist;
            nearest = stnName;
        }
    }
    return { name: nearest, distanceKm: minDist };
}

let kmaCache = { time: 0, map: null };

// 기상청 실시간 관측 데이터 (수도권기상청/날씨누리 공식 REST API, 60초 캐싱)
const KMA_ALL_STN_IDS = '90,93,95,98,99,100,101,102,104,105,106,108,112,114,115,119,121,127,129,130,131,133,135,136,137,138,140,143,146,152,155,156,159,162,165,168,169,170,172,174,177,184,185,188,189,192,201,211,212,216,217,221,226,232,235,236,238,239,243,244,245,247,248,251,252,253,254,255,257,258,259,260,261,262,263,264,266,268,271,272,273,276,277,278,279,281,283,284,285,288,289,294,295';

async function fetchKmaWeatherMap() {
    const now = Date.now();
    if (kmaCache.map && now - kmaCache.time < 60000) {
        return kmaCache.map;
    }

    try {
        const res = await fetch(`https://www.weather.go.kr/w/renew2021/rest/main/current-weather-obs-stn.do?stns=${KMA_ALL_STN_IDS}`, {
            signal: AbortSignal.timeout(3500),
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        if (res.ok) {
            const json = await res.json();
            if (json && Array.isArray(json.data) && json.data.length > 0) {
                const map = new Map();
                for (const item of json.data) {
                    const name = (item.stnKo || '').trim();
                    const desc = (item.wwKo || '').trim();
                    const temp = item.ta ? Math.round(parseFloat(item.ta)) : null;
                    const rn_hr1 = item.rnHr1 ? parseFloat(item.rnHr1) : 0;
                    const icon = item.icon || '';
                    if (name) {
                        map.set(name, { name, desc, temp, rn_hr1, icon });
                    }
                }
                if (map.size > 0) {
                    kmaCache = { time: now, map };
                    return map;
                }
            }
        }
    } catch (e) {
        // Fallback to legacy XML if REST endpoint fails
    }

    // Fallback: sfc_web_map.xml
    const res = await fetch('https://www.kma.go.kr/XML/weather/sfc_web_map.xml', {
        signal: AbortSignal.timeout(3500)
    });
    if (!res.ok) throw new Error(`KMA HTTP ${res.status}`);
    const xml = await res.text();

    const map = new Map();
    const regex = /<local\s+([^>]+)>([^<]+)<\/local>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
        const attrs = match[1];
        const name = match[2].trim();
        const descM = attrs.match(/desc="([^"]+)"/);
        const taM = attrs.match(/ta="([^"]+)"/);
        const rnM = attrs.match(/rn_hr1="([^"]+)"/);
        const iconM = attrs.match(/icon="([^"]+)"/);

        const desc = descM ? descM[1] : '';
        const temp = taM ? Math.round(parseFloat(taM[1])) : null;
        const rn_hr1 = rnM ? parseFloat(rnM[1]) : 0;
        const icon = iconM ? iconM[1] : '';

        map.set(name, { name, desc, temp, rn_hr1, icon });
    }

    if (map.size === 0) throw new Error('KMA 관측소 데이터 비어있음');
    kmaCache = { time: now, map };
    return map;
}

// 기상청 관측소 데이터 한국어 기상 상태 및 이모지 매핑
function parseKmaWeather(stnData) {
    const desc = stnData.desc || '맑음';
    const rn = stnData.rn_hr1 || 0;
    const isNight = (() => {
        const h = new Date().getHours();
        return h >= 20 || h < 6;
    })();

    let emoji = '☀️';
    let finalDesc = desc;

    if (desc.includes('눈') || desc.includes('진눈깨비')) {
        emoji = '❄️';
        finalDesc = '눈';
    } else if (desc.includes('뇌우') || desc.includes('천둥번개')) {
        emoji = '⛈️';
        finalDesc = '뇌우';
    } else if (desc.includes('소나기')) {
        emoji = '🌦️';
        finalDesc = '소나기';
    } else if (desc.includes('이슬비') || desc.includes('약한이슬비')) {
        emoji = '🌦️';
        finalDesc = '이슬비';
    } else if (desc.includes('강한 비') || desc.includes('장대비') || desc.includes('폭우')) {
        emoji = '🌧️';
        finalDesc = '강한 비';
    } else if (desc.includes('비')) {
        if (rn >= 10.0) {
            emoji = '🌧️';
            finalDesc = '강한 비';
        } else if (rn >= 0.5) {
            emoji = '🌧️';
            finalDesc = '비';
        } else {
            emoji = '🌦️';
            finalDesc = '이슬비';
        }
    } else if (desc.includes('안개') || desc.includes('박무') || desc.includes('연무')) {
        emoji = '🌫️';
        finalDesc = '안개';
    } else if (desc.includes('흐림') || desc.includes('흐려짐')) {
        emoji = '☁️';
        finalDesc = '흐림';
    } else if (desc.includes('구름많음')) {
        emoji = isNight ? '☁️' : '⛅';
        finalDesc = '구름많음';
    } else if (desc.includes('구름조금')) {
        emoji = isNight ? '🌙' : '🌤️';
        finalDesc = '구름조금';
    } else {
        emoji = isNight ? '🌕' : '☀️';
        finalDesc = '맑음';
    }

    return {
        temp: stnData.temp,
        desc: finalDesc,
        emoji,
        rn: stnData.rn_hr1
    };
}

// WMO 날씨 코드 및 실시간 기상 상태(강수량, 구름량, 주야간) 통합 매핑 (Open-Meteo fallback용)
function parseWeatherCode(code, current) {
    const rain = (current && (current.rain || current.precipitation || current.showers)) || 0;
    const snow = (current && current.snowfall) || 0;
    const cloud = current && current.cloud_cover !== undefined ? current.cloud_cover : null;
    const isNight = current && current.is_day === 0;

    // 1. 강수/강설/뇌우 (실제 강수량 측정치 및 WMO 코드 통합 판정)
    if (snow > 0 || (code >= 71 && code <= 77) || code === 85 || code === 86) {
        return { desc: '눈', emoji: '❄️' };
    }
    if (code >= 95) {
        return { desc: '뇌우', emoji: '⛈️' };
    }
    if ((code >= 80 && code <= 82) || (current && current.showers > 0)) {
        return { desc: '소나기', emoji: '🌦️' };
    }
    if (rain >= 3.0) {
        return { desc: '강한 비', emoji: '🌧️' };
    }
    if (rain >= 0.5 || (code >= 61 && code <= 65)) {
        return { desc: '비', emoji: '🌧️' };
    }
    if (rain > 0 || (code >= 51 && code <= 55)) {
        return { desc: '이슬비', emoji: '🌦️' };
    }

    // 2. 안개
    if (code === 45 || code === 48) {
        return { desc: '안개', emoji: '🌫️' };
    }

    // 3. 구름량 / WMO 코드 보정
    if (code === 3 || (cloud !== null && cloud >= 80)) {
        return { desc: '흐림', emoji: '☁️' };
    }
    if (code === 2 || (cloud !== null && cloud >= 50)) {
        return { desc: '구름많음', emoji: isNight ? '☁️' : '⛅' };
    }
    if (code === 1 || (cloud !== null && cloud >= 20)) {
        return { desc: '구름조금', emoji: isNight ? '🌙' : '🌤️' };
    }
    return { desc: '맑음', emoji: isNight ? '🌕' : '☀️' };
}

// 전국 주요 날씨 기반 대표 이모지 산출
function getRepresentativeEmoji(weatherData) {
    const list = Object.values(weatherData);
    if (list.some(w => w.desc.includes('눈'))) return '❄️';
    if (list.some(w => w.desc.includes('뇌우'))) return '⛈️';
    if (list.some(w => w.desc.includes('비') || w.desc.includes('소나기'))) return '🌧️';
    if (list.filter(w => w.desc === '흐림').length >= 3) return '☁️';
    if (list.filter(w => w.desc.includes('구름')).length >= 3) return '⛅';
    return '☀️';
}

// 전국 7대 기본 도시 실시간 날씨 조회 (기상청 KMA 1순위, Open-Meteo fallback)
async function fetchNationalWeather() {
    try {
        const kmaMap = await fetchKmaWeatherMap();
        const resultMap = {};
        const stnAlias = {
            '강릉': ['강릉', '북강릉'],
            '춘천': ['춘천', '북춘천']
        };

        for (const city of NATIONAL_CITIES) {
            let stn = kmaMap.get(city);
            if (!stn && stnAlias[city]) {
                for (const a of stnAlias[city]) {
                    if (kmaMap.get(a)) { stn = kmaMap.get(a); break; }
                }
            }
            if (stn && stn.temp !== null) {
                const parsed = parseKmaWeather(stn);
                resultMap[city] = {
                    temp: parsed.temp,
                    desc: parsed.desc,
                    emoji: parsed.emoji
                };
            }
        }

        if (Object.keys(resultMap).length === NATIONAL_CITIES.length) {
            return resultMap;
        }
    } catch (kmaErr) {
        console.warn('⚠️ [weather] 기상청 KMA 전국 날씨 조회 실패, Open-Meteo fallback 시도:', kmaErr.message);
    }

    // Fallback: Open-Meteo
    const lats = NATIONAL_CITIES.map(k => CITY_COORDS[k].lat).join(',');
    const lons = NATIONAL_CITIES.map(k => CITY_COORDS[k].lon).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,is_day&timezone=Asia%2FSeoul`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const resultMap = {};
    if (Array.isArray(data)) {
        data.forEach((item, idx) => {
            const cityName = NATIONAL_CITIES[idx];
            if (item && item.current) {
                const w = parseWeatherCode(item.current.weather_code, item.current);
                resultMap[cityName] = {
                    temp: Math.round(item.current.temperature_2m),
                    desc: w.desc,
                    emoji: w.emoji
                };
            }
        });
    }

    if (Object.keys(resultMap).length === 0) {
        throw new Error('전국 날씨 응답이 비어 있습니다.');
    }

    return resultMap;
}

// 특정 단일 지역 실시간 날씨 조회 (기상청 KMA 1순위, Open-Meteo fallback)
async function fetchSingleCityWeather(cityName, lat, lon) {
    try {
        const kmaMap = await fetchKmaWeatherMap();
        // 1. 관측소명 직접 일치
        let stn = kmaMap.get(cityName);
        if (!stn && (cityName === '강릉' || cityName === '춘천')) {
            stn = kmaMap.get(`북${cityName}`);
        }

        // 2. 인접 관측소 탐색
        if (!stn && typeof lat === 'number' && typeof lon === 'number') {
            const nearest = findNearestKmaStation(lat, lon);
            if (nearest && nearest.name) {
                stn = kmaMap.get(nearest.name);
            }
        }

        if (stn && stn.temp !== null) {
            const parsed = parseKmaWeather(stn);
            return {
                temp: parsed.temp,
                desc: parsed.desc,
                emoji: parsed.emoji
            };
        }
    } catch (kmaErr) {
        console.warn(`⚠️ [weather] ${cityName} KMA 실측 조회 실패, Open-Meteo fallback 시도:`, kmaErr.message);
    }

    // Fallback: Open-Meteo
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,is_day&timezone=Asia%2FSeoul`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data && data.current) {
        const w = parseWeatherCode(data.current.weather_code, data.current);
        return {
            temp: Math.round(data.current.temperature_2m),
            desc: w.desc,
            emoji: w.emoji
        };
    }
    throw new Error('단일 지역 날씨 데이터 수신 실패');
}

// 일별 예보 WMO 코드 및 강수확률/예상 강수량 매핑
function parseDailyWeatherCode(code, precip = 0, pop = 0) {
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
        return { desc: '눈', emoji: '❄️' };
    }
    if (code >= 95) {
        return { desc: '뇌우', emoji: '⛈️' };
    }
    if (code >= 80 && code <= 82) {
        return { desc: '소나기', emoji: '🌦️' };
    }
    if (precip >= 10.0 || (code >= 61 && code <= 65 && precip >= 5.0)) {
        return { desc: '강한 비', emoji: '🌧️' };
    }
    if (precip >= 1.0 || (code >= 61 && code <= 65) || (pop >= 60 && precip >= 0.5)) {
        return { desc: '비', emoji: '🌧️' };
    }
    if (precip > 0 || (code >= 51 && code <= 55)) {
        return { desc: '이슬비', emoji: '🌦️' };
    }
    if (code === 45 || code === 48) {
        return { desc: '안개', emoji: '🌫️' };
    }
    if (code === 3) {
        return { desc: '흐림', emoji: '☁️' };
    }
    if (code === 2) {
        return { desc: '구름많음', emoji: '⛅' };
    }
    if (code === 1) {
        return { desc: '구름조금', emoji: '🌤️' };
    }
    return { desc: '맑음', emoji: '☀️' };
}

// 내일 전국 주요 7대 도시 예보 조회 (배치 호출)
async function fetchTomorrowNationalForecast() {
    const lats = NATIONAL_CITIES.map(k => CITY_COORDS[k].lat).join(',');
    const lons = NATIONAL_CITIES.map(k => CITY_COORDS[k].lon).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=Asia%2FSeoul`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const resultMap = {};
    if (Array.isArray(data)) {
        data.forEach((item, idx) => {
            const cityName = NATIONAL_CITIES[idx];
            if (item && item.daily) {
                const minTemp = Math.round(item.daily.temperature_2m_min[1]);
                const maxTemp = Math.round(item.daily.temperature_2m_max[1]);
                const code = item.daily.weather_code[1];
                const pop = item.daily.precipitation_probability_max ? item.daily.precipitation_probability_max[1] : 0;
                const precip = item.daily.precipitation_sum ? item.daily.precipitation_sum[1] : 0;
                const parsed = parseDailyWeatherCode(code, precip, pop);

                resultMap[cityName] = {
                    minTemp,
                    maxTemp,
                    desc: parsed.desc,
                    emoji: parsed.emoji,
                    pop,
                    precip
                };
            }
        });
    }

    if (Object.keys(resultMap).length === 0) {
        throw new Error('내일 전국 예보 응답이 비어 있습니다.');
    }

    return resultMap;
}

// 특정 단일 지역 내일 날씨 예보 조회
async function fetchTomorrowCityForecast(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=Asia%2FSeoul`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data && data.daily) {
        const minTemp = Math.round(data.daily.temperature_2m_min[1]);
        const maxTemp = Math.round(data.daily.temperature_2m_max[1]);
        const code = data.daily.weather_code[1];
        const pop = data.daily.precipitation_probability_max ? data.daily.precipitation_probability_max[1] : 0;
        const precip = data.daily.precipitation_sum ? data.daily.precipitation_sum[1] : 0;
        const parsed = parseDailyWeatherCode(code, precip, pop);

        return {
            minTemp,
            maxTemp,
            desc: parsed.desc,
            emoji: parsed.emoji,
            pop,
            precip
        };
    }
    throw new Error('내일 지역 예보 데이터 수신 실패');
}

/**
 * 사용자 입력 문자열에서 최적의 지역 키 매칭
 */
function findCityKey(inputQuery) {
    if (!inputQuery || typeof inputQuery !== 'string') return null;
    const clean = inputQuery.trim().replace(/\s+/g, '');
    if (!clean) return null;

    // 1. 정확히 일치하는 키
    if (CITY_COORDS[clean]) return clean;

    // 2. 접미사 1단계 제거 (예: '수원시' -> '수원', '강남구' -> '강남', '신탄진동' -> '신탄진')
    const stripped = clean.replace(/(?:특별시|광역시|특별자치시|특별자치도|해수욕장|[시군구동읍면리역항산도])$/, '');
    if (stripped && CITY_COORDS[stripped]) return stripped;

    // 2-2. 복합 접미사 제거 (예: '신탄진역', '유성온천', '송도국제도시', '판교동', '조치원읍')
    const stripped2 = clean.replace(/(?:해수욕장|국제도시|혁신도시|신도시|지구|온천|[시군구동읍면리역항산도])+$/, '');
    if (stripped2 && CITY_COORDS[stripped2]) return stripped2;

    // 3. CITY_COORDS 내에서 포함 관계 탐색 (긴 이름 우선)
    const keys = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length);

    for (const key of keys) {
        if (clean.includes(key) || (stripped && key.includes(stripped)) || (stripped2 && key.includes(stripped2))) {
            return key;
        }
    }

    return null;
}

module.exports = {
    name: 'weather',
    group: 'weather',
    icon: '⛅',
    aliases: ['!날씨', '!weather', '!전국날씨', '!내일날씨', '!내일', '!내일의날씨', '!tomorrowweather'],
    description: '전국 및 주요 도시 실시간 날씨/내일 예보 및 일출/일몰 시간 조회',

    web: {
        title: '전국 날씨 & 내일 예보',
        icon: '⛅',
        description: '전국 7대 거점 및 모든 시/군/구 실시간 기상청 날씨 및 내일 예보 조회 모듈',
        category: 'Commands',
        badge: 'Command'
    },

    calculateSunTimes,

    async execute({ cmd, args, _input, ctx }) {
        ctx.setCooldown(cmd, 0, _input);
        const cooldownMsg = ctx.getCooldownMsg(cmd);

        const isTomorrowCmd = cmd === '!내일날씨' || cmd === '!내일' || cmd === '!내일의날씨' || cmd === '!tomorrowweather';
        let rawArg = (args && args.length > 0 && typeof args[0] === 'string')
            ? args.join(' ').trim()
            : '';

        let isTomorrow = isTomorrowCmd;
        if (rawArg.includes('내일')) {
            isTomorrow = true;
            rawArg = rawArg.replace(/내일(?:의날씨|날씨)?/g, '').trim();
        }

        if (rawArg.length > 50) {
            return `⚠️ 지역명이 너무 깁니다. ${cooldownMsg}`;
        }

        // ═══════════════════════════════════════════════════════════
        //  A. 내일 날씨 예보 (!내일날씨, !날씨 내일 등)
        // ═══════════════════════════════════════════════════════════
        if (isTomorrow) {
            const tomorrowDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

            // A-1. 특정 지역 내일 예보
            if (rawArg) {
                const matchedKey = findCityKey(rawArg);
                if (!matchedKey || !CITY_COORDS[matchedKey]) {
                    if (msg.weather && msg.weather.invalid_city) {
                        return msg.weather.invalid_city(rawArg, cooldownMsg);
                    }
                    return `⚠️ "${rawArg}" 지역을 찾을 수 없습니다. (예: 서울, 부산, 수원, 대전, 제주 등) ${cooldownMsg}`;
                }

                const targetCoord = CITY_COORDS[matchedKey];
                const sunTimes = calculateSunTimes(targetCoord.lat, targetCoord.lon, tomorrowDate);
                const sunStr = `🌅 ${sunTimes.sunrise} 🌇 ${sunTimes.sunset}`;

                try {
                    const info = await fetchTomorrowCityForecast(targetCoord.lat, targetCoord.lon);
                    if (msg.weather && msg.weather.tomorrow_city_weather) {
                        return msg.weather.tomorrow_city_weather(
                            matchedKey, info.minTemp, info.maxTemp, info.desc, info.emoji, info.pop, info.precip, sunStr, cooldownMsg
                        );
                    }
                    const rainStr = info.pop > 0 ? (info.precip > 0 ? `, 강수확률 ${info.pop}%, 예상 강수량 ${info.precip}mm` : `, 강수확률 ${info.pop}%`) : '';
                    return `${info.emoji} [내일 ${matchedKey} 날씨] 최저 ${info.minTemp}°C / 최고 ${info.maxTemp}°C (${info.desc}${rainStr}) | ${sunStr} ${cooldownMsg}`;
                } catch (err) {
                    console.error(`⚠️ [weather] ${matchedKey} 내일 예보 호출 실패:`, err.message);
                    if (msg.weather && msg.weather.fetch_error) {
                        return msg.weather.fetch_error(cooldownMsg);
                    }
                    return `⚠️ 내일 날씨 정보를 불러오지 못했습니다. ${cooldownMsg}`;
                }
            }

            // A-2. 내일 전국 7대 거점 예보 요약
            try {
                const weatherData = await fetchTomorrowNationalForecast();
                const summaryItems = NATIONAL_CITIES.map(city => {
                    const info = weatherData[city];
                    if (!info) return `${city} -`;
                    const popStr = info.pop !== undefined && info.pop !== null ? `(${info.pop}%)` : '';
                    return `${city} ${info.minTemp}~${info.maxTemp}°C ${info.desc}${popStr}`;
                });

                const weatherListStr = summaryItems.join(' | ');

                const seoulCoord = CITY_COORDS['서울'];
                const sunTimes = calculateSunTimes(seoulCoord.lat, seoulCoord.lon, tomorrowDate);
                const sunStr = `🌅 ${sunTimes.sunrise} 🌇 ${sunTimes.sunset}`;

                const repEmoji = getRepresentativeEmoji(weatherData);

                if (msg.weather && msg.weather.tomorrow_national_summary) {
                    return msg.weather.tomorrow_national_summary(weatherListStr, sunStr, cooldownMsg, repEmoji);
                }
                return `${repEmoji} [내일 전국 날씨] ${weatherListStr} | ${sunStr} ${cooldownMsg}`;
            } catch (err) {
                console.error('⚠️ [weather] 내일 전국 날씨 예보 호출 실패:', err.message);
                const errText = msg.weather && msg.weather.fetch_error
                    ? msg.weather.fetch_error(cooldownMsg)
                    : `⚠️ 내일 날씨 정보를 불러오지 못했습니다. ${cooldownMsg}`;
                return errText;
            }
        }

        // ═══════════════════════════════════════════════════════════
        //  B. 오늘 실시간 날씨 (!날씨, !날씨 [지역])
        // ═══════════════════════════════════════════════════════════

        // B-1. 특정 지역 실시간 날씨
        if (rawArg) {
            const matchedKey = findCityKey(rawArg);
            if (!matchedKey || !CITY_COORDS[matchedKey]) {
                if (msg.weather && msg.weather.invalid_city) {
                    return msg.weather.invalid_city(rawArg, cooldownMsg);
                }
                return `⚠️ "${rawArg}" 지역을 찾을 수 없습니다. (예: 서울, 부산, 수원, 강릉, 서귀포 등) ${cooldownMsg}`;
            }

            const targetCoord = CITY_COORDS[matchedKey];
            const sunTimes = calculateSunTimes(targetCoord.lat, targetCoord.lon);
            const sunStr = `🌅 ${sunTimes.sunrise} 🌇 ${sunTimes.sunset}`;

            try {
                const info = await fetchSingleCityWeather(matchedKey, targetCoord.lat, targetCoord.lon);
                if (msg.weather && msg.weather.city_weather) {
                    return msg.weather.city_weather(matchedKey, info.temp, info.desc, info.emoji, sunStr, cooldownMsg);
                }
                return `${info.emoji} [${matchedKey} 날씨] 현재 기온: ${info.temp}°C (${info.desc}) | ${sunStr} ${cooldownMsg}`;
            } catch (err) {
                console.error(`⚠️ [weather] ${matchedKey} 날씨 API 호출 실패:`, err.message);
                if (msg.weather && msg.weather.fetch_error) {
                    return msg.weather.fetch_error(cooldownMsg);
                }
                return `⚠️ 날씨 정보를 불러오지 못했습니다. ${cooldownMsg}`;
            }
        }

        // B-2. 오늘 전국 주요 7대 도시 요약 + 일출/일몰 시간 표시
        try {
            const weatherData = await fetchNationalWeather();
            const summaryItems = NATIONAL_CITIES.map(city => {
                const info = weatherData[city];
                if (!info) return `${city} -`;
                return `${city} ${info.temp}°C ${info.desc}`;
            });

            const weatherListStr = summaryItems.join(' | ');

            // 대한민국 대표 기준 (서울 좌표 기반) 일출/일몰 계산
            const seoulCoord = CITY_COORDS['서울'];
            const sunTimes = calculateSunTimes(seoulCoord.lat, seoulCoord.lon);
            const sunStr = `🌅 ${sunTimes.sunrise} 🌇 ${sunTimes.sunset}`;

            const repEmoji = getRepresentativeEmoji(weatherData);

            if (msg.weather && msg.weather.national_summary) {
                return msg.weather.national_summary(weatherListStr, sunStr, cooldownMsg, repEmoji);
            }
            return `${repEmoji} [전국 날씨] ${weatherListStr} | ${sunStr} ${cooldownMsg}`;
        } catch (err) {
            console.error('⚠️ [weather] 전국 날씨 API 호출 실패:', err.message);
            const errText = msg.weather && msg.weather.fetch_error
                ? msg.weather.fetch_error(cooldownMsg)
                : `⚠️ 날씨 정보를 불러오지 못했습니다. ${cooldownMsg}`;
            return errText;
        }
    }
};
