# Round 7: Jaden's walkthrough of the installed app (2026-10-06 21:55Z)

Source: Jaden's own walkthrough of the installed build (main 5906c242). His words are quoted; each item has one owner.

## A. Agents and Settings (owner: agents builder)
1. "Codex... infinitely opening and closing different terminals. I type a message, and it says ACP agent failed. ACP connection closed. Retry doesn't work well. There's no loading. It fails loud." Likely cause: agent child processes spawned without windowsHide from the packaged (GUI) Electron app, so every spawn flashes a console. Also: a restart loop, no loading state, and Retry not working.
2. "In terms of codecs, it doesn't tell you which model you're using."
3. "It says Claude ready, but that actually doesn't work after." / "For Claude Code, the connector says it needs adapter though. I'm not sure what that means." Onboarding status must be honest; explain the adapter plainly and offer a one-click install that the user triggers.
4. "Click to start Claude Code with hooks. Could not start it."
5. "I click on the model picker after that, and my screen just goes gray. I literally can't do anything after that." (blocking: a stuck overlay or scrim)
6. "When the agents thing pops up, it's horrible. The buttons don't match it. The theme isn't there." / "Agent window sucks. It transpons all the other screens. As a pop-up, it's not really clear what the boundaries are."
7. "From double click on desktop to boot up, it's taking a very long time."
8. Settings: "needs a bit of a rework... Some of the button sliders aren't really fitted. They're not really working. Some settings don't save." "make it as simple as possible to understand and connect and configure."

## B. Shell and layout (owner: shell builder)
1. Surface bar: "When you're on architecture, it doesn't show the other ones... I should always just show their surface names." "Closing is a little difficult and unclear. Terminal has no X." "The X's... don't fit in properly."
2. Window controls (minimize, maximize, close) "only expand over the surfaces" and look off.
3. "The surfaces don't need to be always open. They can condense into their little icons when no surface is open, and it can just center the actual chat box."
4. "The way the mock-up shows the surfaces is much of a better format." "The way that the chat assistant looks like its own surface, and the mockup mix up looks way better than... full screen now." Each area becomes a floating rounded card, as in Mix.dc.html.
5. "Top left... It should just be Sequence, and then the workspaces and the projects are on the side rail." "It doesn't let you switch projects on the side rail... It should show all your projects, like in Codex." "The sidebar should be always toggled... unless untoggled."
6. "Terminal: start a project... The default workspace should be a project."
7. "Make sure all the buttons spacing is unique and uniform throughout. Transparent. Nice soft edges." "Make sure the icons are fixed as well in terms of the surfaces when they're minimized."
8. Files: "opening things and HTMLs, they show just the code" (preview rendered HTML, images, markdown).

## C. Board (owner: board builder)
1. "We need a little more depth in the architecture board, so we can just pick up the boxes" (drag nodes; positions persist).
2. "The ASCII on the background also needs to be fixed up."
3. On ML harness: "under not connected, it says SRC... I move that, and then not connected label stays." The group label must follow, or regroup.
4. "Shouldn't zoom out that hard when you expand a certain object... the focused view of the actual microservice to be a little bit more direct."
5. "Easier to use and interact with. Same with the in-depth anatomy boards... more keyboard native, hold space, move around even in draw. Click on an element, exit, simple."
6. "The second you click on diff... the UI doesn't match up. Icons aren't really centered." "Grid view isn't really transparent enough... not big enough for the screen size."

## Rules
Visual components come from uiarc.dev and mockup B, harness logic from DeepSeek, colors from Ramp Kit. Shots at each checkpoint. No live model calls by builders (Codex quota until 2026-10-12); use replay fixtures and fakes.