import React from "react";
import { AppSidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex w-full bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 p-4 lg:p-6 overflow-auto pb-20 lg:pb-6">
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
