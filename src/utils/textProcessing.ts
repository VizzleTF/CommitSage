/**
 * Utility functions for processing text responses from AI models
 */

/**
 * Removes any content between <think></think> tags from the input text
 * @param text - The input text that may contain think tags
 * @returns The text with all think tag content removed
 */
export function removeThinkTags(text: string): string {
    // Remove all content between <think> tags, including the tags themselves
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}