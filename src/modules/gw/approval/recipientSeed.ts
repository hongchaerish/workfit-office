/**
 * 기안 작성 — 서식 기본 수신처를 넣을 때인가.
 * 서식마다 한 번만 넣는다. 예전에는 조직 정보가 다시 올 때마다 다시 판단해, 사용자가 수신처를 모두 지우면
 * 기본 수신처가 저절로 되살아났다(작성 중 내용이 바뀜). 조직 정보를 받기 전에는 판단을 미룬다.
 */
export function shouldSeedRecipients(input: {
  editing: boolean;
  formCode: string;
  /** 이미 기본 수신처를 판단한 서식 코드 */
  seededFor: string | null;
  orgReady: boolean;
  recipientCount: number;
}): boolean {
  if (input.editing || input.seededFor === input.formCode || !input.orgReady) return false;
  return input.recipientCount === 0;
}
