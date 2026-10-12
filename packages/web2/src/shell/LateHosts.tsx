/* The lazy half of LateBoot.tsx: the S5 attention watcher. (The keys are
   eager: KeysHost.tsx.) */
import { AttentionHost } from '../notify/AttentionHost';

export default function LateHosts() {
  return <AttentionHost />;
}
