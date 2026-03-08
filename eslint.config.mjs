import tseslint from "typescript-eslint";

const dashboardModuleRoots = ["agents", "billing", "inbox", "leads", "settings", "studio"];
const relativeDepthPrefixes = ["../", "../../", "../../../", "../../../../"];

function siblingModulePatterns(currentRoot) {
  return dashboardModuleRoots
    .filter((root) => root !== currentRoot)
    .flatMap((root) => relativeDepthPrefixes.map((prefix) => `${prefix}${root}/**`));
}

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**"]
  },
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../app/**", "../../app/**", "../../../app/**", "../../../../app/**"],
              message: "Shared code must not depend on app/*."
            },
            {
              group: ["../modules/**", "../../modules/**", "../../../modules/**", "../../../../modules/**"],
              message: "Shared code must not depend on feature modules."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["apps/web/src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../app/**", "../../app/**", "../../../app/**", "../../../../app/**", "../../../../../app/**"],
              message: "Feature modules must not import from app/*; move shared contracts/providers into shared/*."
            }
          ]
        }
      ]
    }
  },
  ...dashboardModuleRoots.map((root) => ({
    files: [`apps/web/src/modules/dashboard/${root}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "../app/**",
                "../../app/**",
                "../../../app/**",
                "../../../../app/**",
                "../../../../../app/**"
              ],
              message: "Feature modules must not import from app/*; move shared contracts/providers into shared/*."
            },
            {
              group: siblingModulePatterns(root),
              message: "Dashboard modules must not import from sibling modules; move reused code into shared/*."
            }
          ]
        }
      ]
    }
  }))
);
