/**
 * LeetCode Page & API Helper
 * Utility functions to extract LeetCode problem metadata from URL and DOM,
 * and fetch problem details via LeetCode GraphQL if needed.
 */

export class LeetCodeHelper {
  /**
   * Extract problem title slug from current window location or tab URL
   */
  static extractProblemSlug(url) {
    if (!url) return null;
    const match = url.match(/\/problems\/([^\/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Converts slug to a human readable title
   * e.g., "two-sum" -> "Two Sum"
   */
  static formatTitle(slug) {
    if (!slug) return 'LeetCode Problem';
    return slug
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Fetch problem details using LeetCode GraphQL public endpoint
   */
  static async fetchProblemDetails(problemSlug) {
    if (!problemSlug) return null;

    const query = `
      query getProblemDetails($titleSlug: String!) {
        question(titleSlug: $titleSlug) {
          questionId
          title
          titleSlug
          difficulty
          exampleTestcases
          topicTags {
            name
          }
          codeSnippets {
            lang
            langSlug
            code
          }
        }
      }
    `;

    try {
      const response = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          query,
          variables: { titleSlug: problemSlug }
        })
      });

      if (!response.ok) throw new Error(`LeetCode API status: ${response.status}`);
      const data = await response.json();
      return data.data?.question || null;
    } catch (error) {
      console.warn('[DryRun] Failed to fetch LeetCode GraphQL data:', error);
      return null;
    }
  }

  /**
   * Parses sample test cases text string into clean readable format
   */
  static parseTestcases(rawTestcases) {
    if (!rawTestcases) return [];
    return rawTestcases.trim().split('\n').filter(line => line.length > 0);
  }

  /**
   * Converts raw GraphQL exampleTestcases string into structured example array
   * e.g., "[2,7,11,15]\n9\n[3,2,4]\n6" -> [{ id: 1, label: 'Example 1', input: "[2,7,11,15]\n9" }, ...]
   */
  static parseGraphQLTestcases(rawTestcases) {
    if (!rawTestcases) return [];
    const lines = rawTestcases.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    // Group lines if testcase contains multiple parameters, or map each block
    const examples = [];
    let currentInput = [];
    lines.forEach((line) => {
      currentInput.push(line);
      // Rough heuristic: if line ends a parameter set or every 1-2 parameters
      if (currentInput.length >= 2 || lines.length <= 3) {
        examples.push({
          id: examples.length + 1,
          label: `Example ${examples.length + 1}`,
          input: currentInput.join('\n')
        });
        currentInput = [];
      }
    });

    if (currentInput.length > 0) {
      examples.push({
        id: examples.length + 1,
        label: `Example ${examples.length + 1}`,
        input: currentInput.join('\n')
      });
    }

    return examples;
  }
}

