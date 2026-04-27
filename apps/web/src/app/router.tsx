import type { ComponentType } from "react";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import type { RouteObject } from "react-router-dom";
import { DashboardModuleGuard } from "./dashboard/dashboard-module-guard";
import { DashboardShell } from "./dashboard/dashboard-shell";
import { LegacyDashboardRedirect } from "./dashboard/legacy-dashboard-redirect";
import { ProtectedRoute } from "./protected-route";
import { dashboardModules } from "../registry/dashboardModules";

const LANDING_PAGE_PATHS = [
  "/",
  "/pricing",
  "/whatsapp-bot",
  "/website-widget",
  "/whatsapp-api",
  "/lead-capture",
  "/ecommerce-chatbot",
  "/real-estate-chatbot",
  "/education-chatbot",
  "/healthcare-chatbot",
  "/restaurant-chatbot"
] as const;

const LANDING_PAGE_REDIRECTS: Readonly<Record<string, (typeof LANDING_PAGE_PATHS)[number]>> = {
  "/whatsapp-chatbot-india": "/whatsapp-bot",
  "/whatsapp-ai-bot": "/whatsapp-bot",
  "/whatsapp-agent": "/whatsapp-bot",
  "/lead-capture-chatbot": "/lead-capture",
  "/wati-alternative": "/pricing",
  "/aisensy-alternative": "/pricing",
  "/whatsapp-business-api-india": "/whatsapp-api",
  "/no-code-whatsapp-chatbot": "/",
  "/whatsapp-chatbot-real-estate": "/real-estate-chatbot",
  "/ai-chatbot-india": "/",
  "/whatsapp-chatbot-pricing-india": "/pricing",
  "/official-whatsapp-api": "/whatsapp-api",
  "/whatsapp-green-tick": "/whatsapp-api",
  "/whatsapp-lead-capture": "/lead-capture",
  "/lead-generation-chatbot": "/lead-capture",
  "/cart-abandonment-chatbot": "/ecommerce-chatbot",
  "/d2c-whatsapp-bot": "/ecommerce-chatbot",
  "/whatsapp-chatbot-online-store": "/ecommerce-chatbot",
  "/whatsapp-bot-property-agents": "/real-estate-chatbot",
  "/lead-capture-real-estate": "/real-estate-chatbot",
  "/property-chatbot-india": "/real-estate-chatbot",
  "/whatsapp-chatbot-coaching": "/education-chatbot",
  "/admission-chatbot-india": "/education-chatbot",
  "/student-support-chatbot": "/education-chatbot",
  "/whatsapp-chatbot-clinic": "/healthcare-chatbot",
  "/appointment-booking-chatbot": "/healthcare-chatbot",
  "/hospital-chatbot-india": "/healthcare-chatbot",
  "/whatsapp-chatbot-restaurant": "/restaurant-chatbot",
  "/table-booking-chatbot": "/restaurant-chatbot",
  "/food-delivery-chatbot": "/restaurant-chatbot",
  "/ai-chatbot-website": "/website-widget",
  "/lead-capture-widget": "/website-widget"
};

function lazyComponent<TModule>(importer: () => Promise<TModule>, exportName: keyof TModule): RouteObject["lazy"] {
  return async () => {
    const module = await importer();
    return {
      Component: module[exportName] as ComponentType
    };
  };
}

const dashboardChildren: RouteObject[] = [
  {
    index: true,
    element: <LegacyDashboardRedirect />
  },
  {
    path: "contacts",
    element: <Navigate to="/dashboard/leads" replace />
  },
  {
    path: "contacts/:contactId",
    lazy: lazyComponent(() => import("../modules/dashboard/inbox-v2/pages/ContactDetailPage"), "ContactDetailPage")
  },
  ...dashboardModules.map((definition) => ({
    path: definition.path,
    async lazy() {
      const module = await definition.lazyRoute();
      const RouteComponent = module.Component;
      return {
        handle: {
          moduleId: definition.id
        },
        Component: function DashboardModuleRoute() {
          return (
            <DashboardModuleGuard definition={definition}>
              <RouteComponent />
            </DashboardModuleGuard>
          );
        }
      };
    }
  }))
];

export const appRoutes: RouteObject[] = [
  {
    path: "/",
    element: <Outlet />,
    children: [
      ...LANDING_PAGE_PATHS.map((path) => ({
        path,
        lazy: lazyComponent(
          () => import("../pages/landing-orchids/OrchidsLandingPage"),
          "OrchidsLandingPage"
        )
      })),
      ...Object.entries(LANDING_PAGE_REDIRECTS).map(([path, target]) => ({
        path,
        element: <Navigate to={target} replace />
      })),
      {
        path: "/privacy-policy",
        lazy: lazyComponent(() => import("../pages/PrivacyPolicyPage"), "PrivacyPolicyPage")
      },
      {
        path: "/terms-of-service",
        lazy: lazyComponent(() => import("../pages/TermsOfServicePage"), "TermsOfServicePage")
      },
      {
        path: "/contact-us",
        lazy: lazyComponent(() => import("../pages/ContactUsPage"), "ContactUsPage")
      },
      {
        path: "/data-deletion",
        lazy: lazyComponent(() => import("../pages/DataDeletionPage"), "DataDeletionPage")
      },
      {
        path: "/forgot-password",
        lazy: lazyComponent(() => import("../pages/ForgotPasswordPage"), "ForgotPasswordPage")
      },
      {
        path: "/reset-password",
        lazy: lazyComponent(() => import("../pages/ResetPasswordPage"), "ResetPasswordPage")
      },
      {
        path: "/signup",
        lazy: lazyComponent(() => import("../pages/SignupPage"), "SignupPage")
      },
      {
        path: "/super-admin",
        element: <Outlet />,
        children: [
          {
            path: "login",
            lazy: lazyComponent(() => import("../pages/SuperAdminLoginPage"), "SuperAdminLoginPage")
          },
          {
            index: true,
            lazy: lazyComponent(() => import("../pages/SuperAdminPage"), "SuperAdminPage")
          },
          {
            path: "*",
            element: <Navigate to="/super-admin/login" replace />
          }
        ]
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: "/onboarding",
            lazy: lazyComponent(() => import("../pages/OnboardingPage"), "OnboardingPage")
          },
          {
            path: "/onboarding/qr",
            lazy: lazyComponent(() => import("../pages/QrConnectPage"), "QrConnectPage")
          },
          {
            path: "/meta-callback",
            lazy: lazyComponent(() => import("../pages/MetaCallbackPage"), "MetaCallbackPage")
          },
          {
            path: "/purchase",
            lazy: lazyComponent(() => import("../pages/PurchasePage"), "PurchasePage")
          },
          {
            path: "/widget",
            element: <Navigate to="/dashboard/settings/web" replace />
          },
          {
            path: "/dashboard",
            element: <DashboardShell />,
            children: dashboardChildren
          }
        ]
      },
      {
        path: "*",
        element: <Navigate to="/signup" replace />
      }
    ]
  }
];

const router = createBrowserRouter(appRoutes, {
  basename: import.meta.env.BASE_URL,
  future: {
    v7_relativeSplatPath: true
  }
});

export function AppRouter() {
  return <RouterProvider router={router} />;
}
