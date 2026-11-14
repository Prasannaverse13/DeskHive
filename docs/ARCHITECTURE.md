# DeskHive architecture

DeskHive has three layers. The headset app draws the office and takes hands and voice. The floor engine decides what the crew does. Brains and tools do the real work.

## 1. System overview

```mermaid
flowchart TB
  subgraph Quest["Quest 3 / 3S browser (WebXR)"]
    direction TB
    XR["XR session<br/>hand-tracking, plane-detection,<br/>anchors, local-floor"]
    IN["Input<br/>pinch, poke, head gaze,<br/>dwell select, voice"]
    SCENE["Three.js scene<br/>tower, avatars, cards,<br/>panels, perks"]
    VOICE["Voice<br/>VAD, Whisper (WASM),<br/>speech out"]
    XR --> IN --> SCENE
    VOICE --> IN
  end

  subgraph Shared["shared/ (same code in Node and browser)"]
    FLOOR["Floor engine<br/>crew, tasks, mail, boss plan,<br/>steering, memory, XP"]
    ROUTE["Voice routing<br/>name, gaze, selected, Nova"]
    MOCK["Scripted demo crew"]
  end

  subgraph Laptop["Laptop server (optional)"]
    HUB["WebSocket hub<br/>HTTPS :8443 for headset"]
    DISK[("hive/ on disk<br/>registry, tasks, log,<br/>agent memory")]
    STT["Speech to text<br/>Meta, OpenAI, local Whisper"]
    BRAINS["Brains<br/>Llama (Ollama), Muse Spark,<br/>Claude, Codex, Grok, Gemini,<br/>OpenRouter, custom"]
    TOOLS["Tool loop<br/>files, shell, web, mail, ask"]
    MCP["Approval bridge (MCP)<br/>raised hand"]
    METAVR["Meta VR CLI MCP<br/>docs, install, screenshots, traces"]
  end

  SCENE <-->|events and commands| FLOOR
  IN --> ROUTE --> FLOOR
  FLOOR <-->|"hosted demo: in page"| MOCK
  FLOOR <-->|"full mode: WebSocket"| HUB
  HUB <--> DISK
  HUB --> BRAINS --> TOOLS
  BRAINS --> MCP
  BRAINS --> METAVR
  VOICE -->|audio| STT --> ROUTE
```

Hosted demo mode runs the floor engine and the scripted crew inside the page. Nothing to install. Full mode adds the laptop server with real brains.

## 2. One spoken request, end to end

```mermaid
sequenceDiagram
  actor You
  participant Mic as Voice (VAD + Whisper)
  participant Route as voiceRoute
  participant Floor as Floor engine
  participant Brain as Agent brain
  participant Tools as Tool loop
  participant VR as Scene

  You->>Mic: "Kai, why is the header broken?"
  Mic->>Route: text
  Route->>Floor: talk(kai, text)
  Floor->>VR: Kai turns to you, thinking
  Floor->>Brain: message + memory + history
  Brain->>Tools: read file, run command
  Tools-->>Brain: result
  Brain-->>Floor: answer
  Floor->>VR: speech in Kai's voice, caption, done
  Floor->>Floor: gain XP, save conversation
```

Say a name and the request goes to that agent. With no name it goes to the agent you look at, then the selected one, then Nova.

## 3. Raised hand (approval bridge)

```mermaid
sequenceDiagram
  participant Agent as Claude Code agent
  participant MCP as approve-mcp.js
  participant Hub as Server hub
  participant VR as Headset
  actor You

  Agent->>MCP: permission request (git push)
  MCP->>Hub: POST /api/approve
  Hub->>VR: agent raises hand, red ring, "!"
  You->>VR: "Yes" or poke Yes
  VR->>Hub: answer
  Hub-->>MCP: allow or deny
  MCP-->>Agent: decision
```

Autonomy sets what counts as risky: cautious, balanced, autonomous.

## 4. Real desk pipeline (passthrough)

```mermaid
flowchart TD
  A[Enter passthrough] --> B{Saved anchor?}
  B -- yes --> C[restorePersistentAnchor<br/>office returns to the same spot]
  B -- no --> D[detectedPlanes]
  D --> E[Keep horizontal planes<br/>at desk height below eyes]
  E --> F{Table ahead?}
  F -- yes --> G[Snap onto it]
  F -- no --> H[Nearest desk edge, inset]
  G --> I[Fit scale to surface size]
  H --> I
  I --> J[createAnchor + persistent handle]
  D -- none after ~3 s --> K[Float 60 cm ahead at desk height]
  J --> L[Follow anchor every frame]
  K --> L
  C --> L
  M[Place mode: point and pinch] --> I
```

Every step has a fallback, so it works in a room we never tested.

## 5. Performance guards

- Fixed foveated rendering at max.
- Shadows off in the headset.
- Panels redraw at most 6 times a second (2.5 when slow).
- Frame guard: if frames stay under 85% of the display rate for 3 seconds, the city is hidden and panel redraws slow down.
- `?perf` shows a live fps readout.
- Pause on system menu: hands-free listening and speech stop, then resume.

## Folder map

| Folder | Job |
| --- | --- |
| `web/src/main.js` | XR session, input, planes, anchors, loop |
| `web/src/scene/` | tower, avatars, cards, panels, perks |
| `web/src/voice.js` | VAD, in-page Whisper, speech out |
| `shared/` | floor engine, protocol, voice routing, scripted crew |
| `server/` | hub, hive on disk, brains, approval bridge, speech, HTTPS |
| `test/` | engine, brain and voice tests |
