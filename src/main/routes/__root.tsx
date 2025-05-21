import * as React from "react";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/ui/app-sidebar";
import { useEffect } from "react";
import "../globals.css";
import { QueryClient } from "@tanstack/react-query";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootComponent,
});

function RootComponent() {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.add("dark");
  }, []);

  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="w-screen h-screen">
        <SidebarTrigger className="m-2 bg-card" />
        <div className="flex flex-col h-full px-4">
          <Outlet />
        </div>
      </main>
    </SidebarProvider>
  );
}
