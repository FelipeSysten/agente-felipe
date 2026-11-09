import type { Metadata } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Uma família só, com personalidade editorial; números tabulares onde há horário/contagem.
// Variável --font-sans: nome exato que o preset base-nova lê (§0.9.8).
const sans = Schibsted_Grotesk({ variable: "--font-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Atendimento Gaúcho",
  description: "Atendimento do WhatsApp da Gaúcho Café e Pizzaria",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${sans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster theme="light" position="top-center" />
      </body>
    </html>
  );
}
