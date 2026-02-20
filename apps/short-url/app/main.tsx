// SPA Entry Point - React Router client-side routing
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Theme } from "@radix-ui/themes";

// Styles
import "@radix-ui/themes/styles.css";
import "./app.css";

// Admin pages
import AdminLayout from "./routes/admin/layout";
import AdminIndex from "./routes/admin/index";
import NewLink from "./routes/admin/new";
import EditLink from "./routes/admin/edit";
import PluginFramePage from "./routes/admin/plugin-frame";

const router = createBrowserRouter([
  {
    path: "/",
    element: <AdminLayout />,
    children: [
      { index: true, element: <AdminIndex /> },
      { path: "new", element: <NewLink /> },
      { path: "plugin/:pluginId", element: <PluginFramePage /> },
      { path: ":code/edit", element: <EditLink /> },
    ],
  },
], {
  basename: "/_/admin",
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Theme accentColor="blue" grayColor="slate" radius="medium">
      <RouterProvider router={router} />
    </Theme>
  </StrictMode>
);
