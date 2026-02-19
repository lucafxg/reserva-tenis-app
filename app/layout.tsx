import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reservas de Tenis - Club Estudiantes de La Plata",
  description: "Sistema de reserva de canchas de tenis del Club Estudiantes de La Plata",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
