import type { Metadata, Viewport } from "next";
import "@fontsource-variable/ibm-plex-sans";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { StoreProvider } from "@/lib/client/store";

export const metadata: Metadata = {
  title: {
    default: "Skill Co-Occurrence Mining — SIH26087",
    template: "%s — Skill Co-Occurrence Mining",
  },
  description:
    "Association rule mining (Apriori and FP-Growth) on 670,261 real job postings to find skills employers request together, and turn them into combined training programmes. Smart India Hackathon 2026, SIH26087.",
};

export const viewport: Viewport = {
  themeColor: "#0a1628",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StoreProvider>
          <AppShell>{children}</AppShell>
        </StoreProvider>
      </body>
    </html>
  );
}
