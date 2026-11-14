# DeskHive: Devpost text

## Tagline (max 140 chars)
A tiny glass office of AI agents on your real desk. Pinch a task, talk to your team, say yes. Hands only.

## Track
Productivity. Division: New. Best fit awards: Best Agentic Interaction, Best First Five Minutes, Best Reason to Come Back, Best Accessibility Forward.

## Description

### The problem
AI agents work in hidden terminals. You cannot see who is stuck. You cannot see who needs you. You only find out when you scroll a log.

### The idea
DeskHive turns your AI team into a small glass office tower on your real desk. You look in from above like a diorama. You see the team work.

- Typing fast means working.
- Hand on chin means thinking.
- Hand raised with a red ring and a "!" bubble means this agent needs your yes or no.
- Hop and a green check means done.
- A flying envelope means two agents are talking.

You read the whole team in one glance. No logs.

### Hands first
No controller is needed at any step.
- Pinch a task card. Carry it. Drop it on a desk to assign it.
- Poke buttons with your fingertip.
- Talk to anyone by name. Say "Kai, why is the header broken?" and Kai answers in his own voice.
- Look at an agent and talk. Gaze picks who hears you.
- Raised hand? Say yes or no. Or poke Yes.

Everything fits in a two foot radius. It works seated.

### Passthrough with a purpose
On Quest 3 the office uses plane detection to find your real table and snaps onto it. The spot is saved as a persistent spatial anchor. Next time the office is where you left it. The room is part of the product, not a backdrop.

### Real agents, any brain
Every agent has its own brain. Free local Llama is the default. Meta Muse Spark works with a key. Claude Code, Codex, Grok, Gemini, OpenRouter or any OpenAI compatible API also work. You can mix them on one floor. A risky command like a deploy or a git push raises the agent's hand first. Nothing runs until you say yes.

### First five minutes
Nova coaches you in four short spoken steps with a bouncing arrow: pinch a card, talk to someone, poke Deploy, answer the raised hand. No wall of text.

### A reason to come back
Shipped work earns XP. Each office level unlocks something you see: a trophy, a neon sign, a rooftop garden, a delivery drone, a helipad and the city at night. There is a daily goal and a streak. When you return, Nova tells you what the team shipped while you were away.

### Accessibility
High contrast mode. Bigger panels. Look to select, so no hands are needed. Voice for every hand action. Every agent line shows as a caption. Every press has a click sound.

### How we built it
WebXR with Three.js. Hand tracking, plane detection, anchors, fixed foveation and pause on system menu. A shared floor engine runs in Node and in the browser. A scripted demo crew runs fully in the page, so judges need nothing installed. Voice uses Whisper running inside the page. We tested with Meta's Immersive Web Emulator and its synthetic room.

### What is next
Real Quest 3 tuning, more templates for the crew, and shared offices for two people.

### Try it
Open the link in the Quest browser. Press Enter passthrough.

## Built with
WebXR, Three.js, Vite, Node.js, WebSocket, Whisper (WASM), Llama (Ollama), Meta Muse Spark, Meta Immersive Web Emulator

## Video script (under 3 min)

Record in the emulator at http://localhost:8080/?emu. Voice over in plain words.

0:00 to 0:15. Hook. Show a terminal full of logs. Say: "This is how we watch AI agents today. We cannot see them."
0:15 to 0:35. Cut to the office tower on the desk. Say: "This is DeskHive. Your AI team in a tiny office on your real desk."
0:35 to 1:00. Passthrough. Press Enter passthrough. The office snaps onto the desk. Say: "It finds my real table with plane detection and remembers it with an anchor."
1:00 to 1:30. Hands. Pinch a task card and drop it on a desk. Poke a button. Say: "No controller. Pinch to carry. Poke to press."
1:30 to 2:00. Talk. Say a name and a request. The agent answers. Show the envelope flying between two agents.
2:00 to 2:25. Raised hand. Poke Deploy. The ops agent raises a hand with a red ring. Say yes. It ships. Say: "Nothing risky runs without my yes."
2:25 to 2:45. Come back loop. Level up. Show the trophy and the drone. Show the welcome back recap.
2:45 to 3:00. Close. Show Access button and look to select. Say: "Hands first. Seated. Open to everyone. DeskHive."

Rules check: under 3 minutes. Public YouTube or Vimeo link. No AI generated video. Emulator footage is allowed.
