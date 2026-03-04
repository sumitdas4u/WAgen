import { deleteUserById, getUserAuthIdentityById } from "./user-service.js";
import { disconnectMetaBusinessConnection } from "./meta-whatsapp-service.js";
import { whatsappSessionManager } from "./whatsapp-session-manager.js";
import { deleteFirebaseUserByUid } from "./firebase-admin.js";

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

  if (identity.firebase_uid) {
    try {
      await deleteFirebaseUserByUid(identity.firebase_uid);
    } catch (error) {
      console.warn(
        `[AccountDeletion] Firebase user cleanup failed user=${userId} uid=${identity.firebase_uid}: ${(error as Error).message}`
      );
    }
  }

  return true;
}
