const fs = require("node:fs");

const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || "./google-services.json";
const easProjectId = process.env.EXPO_PROJECT_ID || "31dc9ce0-3941-48a8-b7d7-4cb44646e55d";

module.exports = {
  expo: {
    name: "WAgen Agent",
    slug: "wagen",
    owner: "sumitdas4u",
    version: "1.2.0",
    orientation: "portrait",
    scheme: "wagenagent",
    userInterfaceStyle: "light",
    android: {
      package: "com.wagenai.agent",
      usesCleartextTraffic: true,
      permissions: ["POST_NOTIFICATIONS"],
      ...(fs.existsSync(googleServicesFile) ? { googleServicesFile } : {})
    },
    plugins: [
      "expo-secure-store",
      [
        "expo-notifications",
        {
          color: "#16a34a",
          defaultChannel: "messages"
        }
      ]
    ],
    extra: {
      apiUrl: process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000",
      eas: {
        projectId: easProjectId
      }
    }
  }
};
