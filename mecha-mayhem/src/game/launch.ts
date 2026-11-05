/**
 * Launch parameters (map, story chapter, custom map, auto-play, lobby).
 * Normal builds keep them in the URL query. The Artifact build (vite --mode artifact)
 * runs inside a hosted frame where the URL cannot carry a query string, so the next
 * launch is handed over through sessionStorage and the frame reloads itself.
 */
const KEY = 'mecha-mayhem:launch';
const ARTIFACT = import.meta.env.MODE === 'artifact';

function readInitial(): URLSearchParams {
  const params = new URLSearchParams(location.search);
  try {
    const pending = sessionStorage.getItem(KEY);
    if (pending !== null) {
      sessionStorage.removeItem(KEY);
      for (const [k, v] of new URLSearchParams(pending)) params.set(k, v);
    }
  } catch { /* storage blocked: query only */ }
  return params;
}

export const launchParams = readInitial();
export const launchSearch = `?${launchParams.toString()}`;
export const isArtifactBuild = ARTIFACT;

/** Copy of the current launch parameters to edit before relaunching. */
export function nextLaunch(): URLSearchParams { return new URLSearchParams(launchParams); }

export function relaunch(params: URLSearchParams): void {
  if (ARTIFACT) {
    try {
      sessionStorage.setItem(KEY, params.toString());
      location.reload();
      return;
    } catch { /* fall through to a query-string navigation */ }
  }
  const url = new URL(location.href);
  url.search = params.toString();
  location.href = url.href;
}

/** Drop one-shot flags (like play=1) from the visible URL after use. */
export function forget(key: string): void {
  launchParams.delete(key);
  if (!new URLSearchParams(location.search).has(key)) return;
  const url = new URL(location.href);
  url.searchParams.delete(key);
  history.replaceState(null, '', url.search || url.pathname);
}

/**
 * Model file to request. The Artifact host does not serve .glb, so that build ships each
 * model as glTF JSON with embedded buffers (scripts/artifact.mjs) and forces the glTF loader.
 */
export function modelFile(file: string): { file: string; ext: string | undefined } {
  return ARTIFACT ? { file: file.replace(/\.glb$/, '.gltf.json'), ext: '.gltf' } : { file, ext: undefined };
}
