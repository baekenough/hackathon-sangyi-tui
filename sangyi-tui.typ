#set page(
  paper: "presentation-16-9",
  margin: (x: 2cm, y: 1.5cm),
  fill: rgb("#0a0a0a"),
)

#set text(
  font: "Helvetica Neue",
  size: 11pt,
  fill: rgb("#e8e8e8"),
)

#let accent = rgb("#007aff")
#let glass = rgb("#1c1c1e")
#let border-color = rgb("#2c2c2e")

#show heading.where(level: 1): it => {
  set text(size: 28pt, weight: "bold", fill: accent)
  block(below: 1.5em, it)
}

#show heading.where(level: 2): it => {
  set text(size: 20pt, weight: "semibold", fill: rgb("#ffffff"))
  block(above: 1.2em, below: 0.8em, it)
}

#show heading.where(level: 3): it => {
  set text(size: 14pt, weight: "medium", fill: accent)
  block(above: 0.8em, below: 0.5em, it)
}

#let glass-box(content, color: glass) = {
  rect(
    width: 100%,
    fill: color.lighten(5%),
    stroke: 1pt + border-color,
    radius: 8pt,
    inset: 16pt,
    content
  )
}

#let info-box(title, content) = {
  glass-box[
    #text(weight: "bold", size: 12pt, fill: accent)[#title]
    #v(0.3em)
    #content
  ]
}

#align(center)[
  #v(2em)
  #text(size: 36pt, weight: "black", fill: accent)[sangyi-tui]
  #v(0.5em)
  #text(size: 18pt, fill: rgb("#a0a0a0"))[Zero Backend, All Local AI Agent Orchestration]
  #v(0.3em)
  #text(size: 12pt, fill: rgb("#707070"))[https://sangyi-tui.vercel.app]
  #v(2em)
]

= 프로젝트 개요

#grid(
  columns: (1fr, 1fr),
  gutter: 1em,
  info-box("핵심 컨셉")[
    - *Zero Backend State*: 모든 데이터 로컬 저장
    - *32 Agents Catalog*: 클라이언트 측 멀티 에이전트
    - *SQL-Queryable Local Data*: DuckDB WASM 활용
    - *Glassmorphism Design*: Apple 스타일 다크 모드
  ],
  info-box("기술 스택")[
    - *Frontend*: Vanilla JS (프레임워크 없음)
    - *Database*: DuckDB WASM + IndexedDB
    - *Backend*: Vercel Edge Function (Stateless)
    - *API*: Anthropic SDK (SSE Streaming)
  ],
)

#pagebreak()

= 기술 아키텍처

#glass-box[
  #align(center)[
    #text(size: 10pt, font: "Courier New", fill: rgb("#00d4aa"))[
      ```
      ┌─────────────────────────────────────────────────────────┐
      │                   Browser (Client)                      │
      │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
      │  │  Vanilla JS  │  │  DuckDB WASM │  │  IndexedDB   │  │
      │  │   (app.js)   │  │  (10 tables) │  │ (Persistence)│  │
      │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
      │         │                 │                 │          │
      │         └─────────────────┴─────────────────┘          │
      │                           │                            │
      └───────────────────────────┼────────────────────────────┘
                                  │ SSE Streaming
                                  ▼
      ┌─────────────────────────────────────────────────────────┐
      │            Vercel Edge Function (Stateless)             │
      │  ┌──────────────────────────────────────────────────┐   │
      │  │  api/chat.ts - Anthropic SDK + SSE Proxy        │   │
      │  └──────────────────────────────────────────────────┘   │
      └─────────────────────────────────────────────────────────┘
                                  │
                                  ▼
      ┌─────────────────────────────────────────────────────────┐
      │              Anthropic API (Claude Models)              │
      │        Sonnet 4.5 / Haiku 4.5 / Opus 4.6               │
      └─────────────────────────────────────────────────────────┘
      ```
    ]
  ]
]

#v(1em)

#grid(
  columns: (1fr, 1fr, 1fr),
  gutter: 1em,
  info-box("Frontend")[
    - Pure Vanilla JS
    - SPA 아키텍처
    - Zero dependencies
    - 반응형 디자인
  ],
  info-box("Database")[
    - DuckDB WASM (인브라우저)
    - 10-table schema
    - IndexedDB 영속성
    - SQL 쿼리 지원
  ],
  info-box("Backend")[
    - Vercel Edge (Stateless)
    - SSE Streaming
    - Session UUID 관리
    - Token 비용 추적
  ],
)

#pagebreak()

= 핵심 기능

#glass-box[
  === 1. SSE 스트리밍 채팅
  - 실시간 AI 응답 스트리밍 (Server-Sent Events)
  - 마크다운 렌더링 + Tool Call 시각화
  - 메시지별 토큰 비용 추적 (input/output)
]

#v(0.8em)

#glass-box[
  === 2. DuckDB WASM 데이터 레이어
  - *10개 테이블 스키마*: sessions, workspaces, messages, agents, skills, guides, teams, team_members, tasks, cost_tracking
  - *IndexedDB 영속성*: 세션 간 완전한 데이터 보존
  - *SQL 쿼리 가능*: 로컬 데이터 직접 분석
]

#v(0.8em)

#glass-box[
  === 3. 워크스페이스 관리
  - 멀티 워크스페이스 지원
  - 인라인 이름 변경
  - 워크스페이스별 시스템 프롬프트
  - 삭제 확인 다이얼로그
]

#v(0.8em)

#grid(
  columns: (1fr, 1fr),
  gutter: 1em,
  glass-box[
    === 4. 에이전트 카탈로그
    - *32개 에이전트* 프리셋
    - *16개 스킬* 라이브러리
    - *7개 가이드* 문서
    - 토글 스위치로 활성화
  ],
  glass-box[
    === 5. Agent Teams UI
    - 팀 생성 및 멤버 추가
    - Task CRUD 인터페이스
    - 드래그 앤 드롭 지원
    - 병렬 실행 계획
  ],
)

#pagebreak()

= 주요 기술 특징

#let feature-table = table(
  columns: (auto, 1fr),
  stroke: 1pt + border-color,
  fill: (x, y) => if y == 0 { glass.lighten(15%) } else { glass },
  align: (left, left),
  inset: 10pt,

  [*기능*], [*상세*],
  [\@Mention 자동완성], [퍼지 검색 + 키보드 네비게이션],
  [비용 추적], [토큰 사용량 배지, 조합 가능한 시스템 프롬프트],
  [모델 선택기], [Sonnet 4.5 / Haiku 4.5 / Opus 4.6],
  [세션 관리], [crypto.randomUUID() 기반],
  [Factory Reset], [전체 데이터 초기화 기능],
  [SSE 스트리밍], [실시간 AI 응답 렌더링],
)

#feature-table

#v(1em)

#glass-box[
  === UI 디자인 철학

  #grid(
    columns: (auto, 1fr),
    gutter: 1em,
    align: horizon,

    text(size: 40pt)[🎨],
    [
      - *Apple 스타일 Glassmorphism*: backdrop-filter blur 효과
      - *다크 모드*: \#0a0a0a 배경 + 그라데이션 오브
      - *레이아웃*: 사이드바 + 메인 채팅 + 우측 패널 (설정)
      - *애니메이션*: 부드러운 전환 효과
    ],
  )
]

#pagebreak()

= 파일 구조

#glass-box[
  #text(size: 9pt, font: "Courier New")[
    ```
    sangyi-tui/
    ├── api/
    │   └── chat.ts              # Vercel Edge Function (SSE Streaming)
    ├── public/
    │   ├── js/
    │   │   ├── app.js           # 메인 애플리케이션 컨트롤러
    │   │   ├── db.js            # DuckDB WASM 데이터베이스 레이어
    │   │   ├── chat.js          # 채팅 메시지 핸들링
    │   │   ├── mentions.js      # @mention 자동완성
    │   │   └── teams.js         # Agent Teams UI
    │   ├── css/
    │   │   └── style.css        # Glassmorphism 스타일링
    │   └── data/
    │       ├── agents.json      # 32개 에이전트 카탈로그
    │       ├── skills.json      # 16개 스킬 데이터
    │       └── guides.json      # 7개 가이드 문서
    └── vercel.json              # Vercel 배포 설정
    ```
  ]
]

#pagebreak()

= sangyi-moru와의 차별화

#let comparison-table = table(
  columns: (auto, 1fr, 1fr),
  stroke: 1pt + border-color,
  fill: (x, y) => if y == 0 { glass.lighten(15%) } else { glass },
  align: (left, left, left),
  inset: 10pt,

  [*구분*], [*sangyi-tui*], [*sangyi-moru*],

  [핵심 스토리],
  [Zero Backend\
   모든 데이터 로컬],
  [Real Code Execution\
   클라우드에서 실제 실행],

  [데이터 레이어],
  [DuckDB WASM\
   브라우저 내부],
  [PostgreSQL\
   \+ Moru volumes],

  [킬러 기능],
  [32-agent\
   클라이언트 측 오케스트레이션],
  [Live Web Preview\
   샌드박스에서 실행],

  [고유 데모],
  [SQL Console\
   로컬 데이터 쿼리],
  [Terminal + Preview\
   클라우드에서 실행],

  [아키텍처],
  [Edge Function\
   (Stateless)],
  [Full-stack\
   (Stateful)],

  [상태 관리],
  [IndexedDB\
   100% 클라이언트],
  [PostgreSQL\
   서버 측 영속성],
)

#comparison-table

#v(1em)

#glass-box(color: accent.lighten(70%))[
  #set text(fill: rgb("#ffffff"))
  *핵심 차별점*: sangyi-tui는 "완전한 로컬 AI 오케스트레이션"을 구현하며,
  sangyi-moru는 "클라우드 기반 실제 코드 실행"을 제공합니다.
  두 프로젝트는 상호 보완적인 접근 방식입니다.
]

#pagebreak()

= 계획된 기능

#grid(
  columns: (1fr, 1fr),
  gutter: 1em,

  glass-box[
    === DuckDB SQL Console
    #v(0.5em)
    - *Cmd+K 단축키*로 콘솔 오픈
    - 로컬 데이터 직접 SQL 쿼리
    - 결과 테이블 시각화
    - 쿼리 히스토리 저장

    #v(0.5em)
    #text(size: 9pt, fill: rgb("#707070"))[
      예시:
      ```sql
      SELECT agent_name, COUNT(*)
      FROM messages
      WHERE agent_name IS NOT NULL
      GROUP BY agent_name;
      ```
    ]
  ],

  glass-box[
    === Agent Team Execution
    #v(0.5em)
    - 병렬 멀티 에이전트 실행
    - Task 의존성 그래프
    - 실시간 진행 상황 모니터링
    - 결과 집계 및 분석

    #v(0.5em)
    #text(size: 9pt, fill: rgb("#707070"))[
      시나리오:
      - Agent 1: 데이터 수집
      - Agent 2: 분석 (Agent 1 의존)
      - Agent 3: 보고서 생성 (Agent 2 의존)
    ]
  ],
)

#v(2em)

#align(center)[
  #glass-box[
    #set text(size: 14pt, weight: "bold", fill: accent)
    *데모 URL*

    #v(0.5em)
    #set text(size: 12pt, weight: "regular", fill: rgb("#ffffff"))
    https://sangyi-tui.vercel.app

    #v(0.3em)
    #set text(size: 10pt, fill: rgb("#a0a0a0"))
    지금 바로 체험해보세요!
  ]
]

#pagebreak()

#align(center + horizon)[
  #v(3em)
  #text(size: 48pt, weight: "black", fill: accent)[감사합니다]
  #v(1em)
  #text(size: 18pt, fill: rgb("#a0a0a0"))[
    Zero Backend, All Local\
    AI Agent Orchestration
  ]
  #v(2em)
  #text(size: 12pt, fill: rgb("#707070"))[
    sangyi-tui.vercel.app
  ]
]
