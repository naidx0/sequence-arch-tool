/*
 * THE CHAT'S LAZILY LOADED PARTS, loaded before a test renders the chat.
 *
 * V3Chat and the panes under it pull the takeover, the connect card, the queue list, the saved-turn readers and the
 * transcript renderers in with React.lazy / import(), so boot stays small. In a test the first use of each is a Vite
 * transform on a server shared with every other worker: under load it takes seconds, and a findBy / waitFor on what it
 * draws expires ("Unable to find ... connect-to-run") while the module is still on its way. A test file that renders the
 * chat calls this in a beforeAll, so it starts from the app's settled state and waits only on what it is testing.
 *
 * NOT IN setup.ts: these modules import stylesheets, and loading them for the whole suite leaks their custom properties
 * into tests that read the bare :root (tokens/graphite.test.ts failed on --cseries and --ctone).
 */
export async function preloadChatLazies(): Promise<void> {
  await Promise.all([
    import('../src/shell2/Takeover'),
    import('../src/shell2/ChangedFiles'),
    import('../src/shell2/ConnectAgents'),
    import('../src/chat/ConnectToRun'),
    import('../src/chat/DecisionCard'),
    import('../src/chat/VirtualTranscript'),
    import('../src/chat/PlainRuns'),
    import('../src/chat/AgentRunsPane'),
    import('../src/components/ComponentOfferCard'),
    import('../src/components/ComponentsPicker'),
    import('../src/composer/PromptQueueList'),
    import('../src/composer/steerClient'),
    import('../src/fanout/FanoutMenu'),
    import('../src/worktree/MergePanel'),
    import('../src/worktree/WorktreeChip'),
    import('../src/worktree/worktreeModel'),
    import('../src/agents/agentRunner'),
    import('../src/agents/agentRunFold'),
    import('../src/agents/savedRuns'),
    import('../src/agents/mergeSavedRuns'),
  ]);
}
