import { deleteUserById, getUserAuthIdentityById } from "./user-service.js";
import { disconnectMetaBusinessConnection } from "./meta-whatsapp-service.js";
import { whatsappSessionManager } from "./whatsapp-session-manager.js";

export async function deleteAccountWithAssociatedData(userId: string): Promise<boolean> {
  const identity = await getUserAuthIdentityById(userId);
  if (!identity) {
    return false;
  }

  try {
    await whatsappSessionManager.disconnectUser(userId);
  } catch (error) {
    console.warn(`[AccountDeletion] QR session cleanup failed user=${userId}: ${(error as Error).message}`);
  }

  try {
    await disconnectMetaBusinessConnection(userId, undefined, { purgeConnectionData: true });
  } catch (error) {
    console.warn(`[AccountDeletion] Meta cleanup failed user=${userId}: ${(error as Error).message}`);
  }

  const deleted = await deleteUserById(userId);
  if (!deleted) {
    return false;
  }

  return true;
}
