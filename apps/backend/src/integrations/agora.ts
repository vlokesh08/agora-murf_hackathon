// agora-token is CommonJS; named imports don't reliably interop under
// Node's ESM loader (tsx), so take the default export and destructure instead.
import agoraToken from "agora-token";
import { env } from "../config/env";

const { RtcRole, RtcTokenBuilder } = agoraToken;

export function isAgoraConfigured() {
  return Boolean(env.agoraAppId && env.agoraAppCertificate);
}

// Short-lived per the blueprint's "backend-generated short-lived provider
// tokens" requirement — well under Agora's 24h hard cap.
const TOKEN_TTL_SECONDS = 3600;

/** Mints an RTC token scoping one user to one voice channel, as a publisher. */
export function buildRtcToken(channelName: string, uid: number): string {
  return RtcTokenBuilder.buildTokenWithUid(
    env.agoraAppId!,
    env.agoraAppCertificate!,
    channelName,
    uid,
    RtcRole.PUBLISHER,
    TOKEN_TTL_SECONDS,
    TOKEN_TTL_SECONDS
  );
}
