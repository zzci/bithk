import { registerBackupContribution } from "@/modules/backup/registry";
import { registerAuthProvider } from "@/shared/middleware/auth-registry";
import { accountBackupContribution } from "./account.backup";
import { oauthSessionAuthProvider } from "./auth/auth.service";
import { apiTokenAuthProvider, chainAuthProviders } from "./tokens/tokens.provider";

export { accountRoutes } from "./account.routes";

registerBackupContribution(accountBackupContribution);
// Cookie session first (carries CSRF surface); fall back to a Personal Access
// Token bearer (CSRF-exempt, no cookie). See FEAT-034.
registerAuthProvider(chainAuthProviders(oauthSessionAuthProvider, apiTokenAuthProvider));
