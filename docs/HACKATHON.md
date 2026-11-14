# Meta VR Start 2026: requirement checklist

Track: Productivity. Division: New Experience. Special awards aimed at: Best Agentic Interaction, Best First Five Minutes, Best Reason to Come Back, Best Accessibility Forward, Boldest Original Concept.

## Hard requirements

| Rule | How DeskHive meets it | Where |
| --- | --- | --- |
| Hands first, end to end | Pinch, poke, ray. Onboarding, menus, hire, approve all work with hands only. Controllers optional. | `web/src/main.js` (hands, `selectstart`, fingertip poke) |
| Hosted link for WebXR | `npm run build:demo` gives a static site. Vercel or GitHub Pages. | `vercel.json`, `.github/workflows/pages.yml` |
| Demo video under 3 min | Script in `DEVPOST.md`. Emulator footage allowed. | `DEVPOST.md` |
| Stays free and online until winners | Static hosting, no keys, no cost. | |
| 60 fps minimum | Foveation on, shadows off, low draw cost, frame guard. | `main.js` `perfTick` |
| No third party logos or ads | Original crew and art. Brand names appear as text only. | `web/src/scene/` |

## Design guidelines

| Guideline | How |
| --- | --- |
| Seated, two foot radius | Tabletop diorama. Everything inside arm reach. Office fits to the desk size. |
| Easy in and out | Loads in seconds. Pause on system menu. Full loop in under 5 minutes. |
| Original, not a wrapper | Remove every AI service and the office, crew, floor engine and scripted brain still run. |

## Judging criteria

| Criterion | Evidence |
| --- | --- |
| Innovation and creativity | Agents as a visible office. Raised hand means they need you. |
| Experience design | Four step spoken coach with a bouncing arrow. Gaze picks who hears you. |
| Technical implementation | See the table below. |
| Polish and presentation | Voxel crew with idle, type, think, cheer. Click sounds. Captions. Level perks. |

## Platform features used (Technical implementation)

| Feature | Use | Where |
| --- | --- | --- |
| Hand tracking | Meta hand models, pinch grab, fingertip poke | `main.js` `XRHandModelFactory` |
| Head gaze | Looking at an agent picks who hears you | `main.js` `updateGaze` |
| Eyes free selection | Look to select (dwell) | `main.js` `updateDwell` |
| Passthrough | Office sits on your real desk | `enterXR('immersive-ar')` |
| Plane detection | Finds the table and snaps onto it | `main.js` `updatePlanes`, `autoSnap` |
| Works in untested rooms | Fallback chain, desk edge, float in front, fit scale | `fitFor`, `placeWorldInFront` |
| Spatial anchors | Office stays on the desk between sessions | `makeAnchor`, `restoreAnchor` |
| FoV aware | Console sits in front of the building, tilted to you, so key buttons stay in the middle of view | `consolePanel` placement |
| Foveation | Fixed foveated rendering at max | `renderer.xr.setFoveation(1)` |
| Pause and resume | Stops listening on `visibilitychange` | `enterXR` |
| Palm pinch left alone | Reserved for the system, never used | |
| Meta emulator | IWER with the Synthetic Environment Module | `web/src/emulator.js` |
| Meta VR CLI | MCP server given to Claude Code agents | `server/brains/cli.js` |
| Meta AI | Muse Spark brain, Muse Voice Transcribe, free Llama default | `server/brains/`, `server/voice.js` |

## Special awards

| Award | Evidence |
| --- | --- |
| Best Agentic Interaction | AI is the core. Spatial agents, voice first, steering mid task, approvals by hand. |
| Best Reason to Come Back | XP, levels, daily goal, streak, perks, while you were away recap. |
| Best First Five Minutes | Spoken coach, four steps, no text wall. |
| Best Accessibility Forward | Voice for every hand action, look to select, high contrast, captions. |
| Boldest Original Concept | Needs depth and a real desk. A floor of agents you look down on. |

## Not proven yet

- Real Quest 3 run (frame rate, hand feel). Tested only in the Meta emulator.
- Mic in Quest Browser.
- Non local API keys (tested with fake servers).
