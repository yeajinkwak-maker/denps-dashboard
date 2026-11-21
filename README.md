# 덴프스 매체 캠페인별 성과 대시보드

유통채널(스마트스토어/자사몰/올리브영)별 메타·네이버 SA·GFA 캠페인 성과를 캠페인→그룹→소재 3단으로 보는 대시보드.

## 아키텍처

- **SA·메타**: `/api/data.js`(Vercel 서버리스 함수)가 AEER(Airbridge Agent) API를 직접 호출해 실시간 조회. 공식 API 키 기반이라 서버에서 완전 자동 동작(전일 마감 기준, 당일 데이터는 AEER에 없음).
- **GFA**: 공식 서버사이드 API가 없어(사용자 로그인 브라우저로만 조회 가능), 로컬 PC의 Claude Code 스케줄 작업이 매시 Aside CLI로 조회해 `gfa_latest.json`을 이 저장소에 커밋·푸시하는 방식으로 반영(완전 실시간 아님, 최근 푸시 시각 표기).

## 환경 변수 (Vercel 프로젝트 설정)

- `AEER_API_TOKEN` — AEER 마이페이지에서 발급한 Bearer 토큰. client_id=93(덴프스) 고정.

## GFA 스냅샷 푸시

`덴프스-report/04_scripts/push_gfa_snapshot.py`가 로컬에서 수집한 GFA 데이터를 이 저장소 형식(`gfa_latest.json`)으로 변환해 git commit+push한다. 매시 Claude Code 스케줄 작업(`denps-live-campaign-refresh`)이 이 스크립트를 호출한다.

## 보안

현재 비밀번호 보호 없음(사용자 요청, 2026-11-21). 필요 시 식봄 대시보드(`sikbom-dashboard-TOTAL`)의 `api/auth.js` 패턴(JWT 토큰 발급+검증)을 참고해 추가 가능.
