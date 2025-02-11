export function calculatePatternSimilarity(pattern1: string, pattern2: string): number {
  // Normalize strings
  const normalize = (str: string) => str.toLowerCase().trim();
  const p1 = normalize(pattern1);
  const p2 = normalize(pattern2);

  // If patterns are identical, return 1
  if (p1 === p2) return 1;

  // Calculate Levenshtein distance
  const matrix: number[][] = [];
  for (let i = 0; i <= p1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= p2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= p1.length; i++) {
    for (let j = 1; j <= p2.length; j++) {
      if (p1[i - 1] === p2[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  // Calculate similarity score (0 to 1)
  const maxLength = Math.max(p1.length, p2.length);
  const distance = matrix[p1.length][p2.length];
  const similarity = 1 - (distance / maxLength);

  return similarity;
} 