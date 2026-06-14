// electron-builder afterSign hook: notarize the macOS app, but only when the
// Apple credentials are present in the environment. Without them (the default
// for now), this is a no-op so unsigned/dev builds still succeed.

const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("[notarize] Apple credentials not set — skipping notarization.");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  console.log(`[notarize] Notarizing ${appName}…`);
  await notarize({
    appPath: `${appOutDir}/${appName}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
  console.log("[notarize] Done.");
};
