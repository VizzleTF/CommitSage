export const messages = {
    fetchingDiff: "Fetching Git changes...",
    analyzingChanges: "Analyzing code changes...",
    generating: "Generating commit message...",
    settingMessage: "Setting commit message...",
    done: "Done!",
    success: "Commit message set in selected Git repository. Generated using {0} model.",
    commandExecution: "Error in command execution:",
    generateCommitMessage: "Failed to generate commit message"
};

export const errorMessages = {
    commandExecution: 'Error in command execution:',
    generateCommitMessage: 'Failed to generate commit message',
    noStagedChanges: 'No staged changes to commit. Please stage your changes first.',
    gitConfigMissing: 'Git user.name or user.email is not configured. Please configure Git before committing.',
    genericError: 'An error occurred: {0}'
};