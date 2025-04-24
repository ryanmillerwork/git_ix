import semver from 'semver';

interface GitHubTag {
    name: string;
    commit: {
        sha: string;
        url: string;
    };
    zipball_url: string;
    tarball_url: string;
    node_id: string;
}

/**
 * Finds the latest valid semantic version tag from a list of GitHub tag objects.
 */
export function getLatestSemanticTag(tags: GitHubTag[]): string | null {
  if (!Array.isArray(tags)) return null;

  const validTags = tags
    .map(tag => tag.name)
    .filter(name => semver.valid(name))
    .sort(semver.rcompare); // Sorts descending (latest first)

  return validTags.length > 0 ? validTags[0] : null;
}

/**
 * Increments a semantic version string based on the bump type.
 */
export function incrementVersion(versionString: string | null, bumpType: 'major' | 'minor' | 'patch'): string {
    const currentVersion = versionString && semver.valid(versionString) ? versionString : '0.0.0';
    
    // Default based on bump type if no valid version provided
    if (currentVersion === '0.0.0' && !versionString) {
        console.warn(`[Utils] No valid base version string provided, defaulting based on bump type.`);
        if (bumpType === 'major') return '1.0.0';
        if (bumpType === 'minor') return '0.1.0';
        return '0.0.1'; // Default to patch
    }

    const nextVersion = semver.inc(currentVersion, bumpType);
    if (!nextVersion) {
        console.error(`[Utils] Failed to increment version '${currentVersion}' with bump type '${bumpType}'. Returning original.`);
        return currentVersion; // Fallback if increment fails
    }
    return nextVersion;
}

/**
 * Basic check for potentially unsafe path segments.
 */
export function hasUnsafePathSegments(path: string): boolean {
    return path.includes('..') || path.startsWith('.') || path.startsWith('/');
}

/**
 * Basic check for potentially unsafe file/folder names.
 */
export function hasInvalidNameChars(name: string): boolean {
    return name.includes('/') || name.includes('\\');
} 