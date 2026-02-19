"use client";

import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar,
  Clock,
  User,
  Shield,
  LogOut,
  Search,
  Wrench,
  Bell,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Settings,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";

// ─────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────

interface Court {
  id: string;
  name: string;
  isActive: boolean;
}

interface AppUser {
  id: string;
  role: "admin" | "user";
  email: string;
  phone: string;
  dni: string;
  userType: "Socio" | "No Socio";
  createdAt: string;
  passwordHash: string;
  isEmailValidated: boolean;
  isPhoneValidated: boolean;
}

interface Reservation {
  id: string;
  userId: string;
  createdBy: string;
  dateISO: string;
  time: string;
  courtId: string;
  status: string;
  price: number;
  createdAt: string;
  updatedAt: string;
  cancelReason?: string;
}

interface Payment {
  id: string;
  reservationId: string;
  method: string | null;
  status: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
  meta: Record<string, unknown>;
}

interface Block {
  id: string;
  courtId: string;
  dateISO: string;
  time: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}

interface AuditEntry {
  id: string;
  at: string;
  by: string;
  action: string;
  detail: string;
}

interface Notification {
  id: string;
  at: string;
  channel: string;
  to: string;
  event: string;
  payload: Record<string, unknown>;
}

interface AppConfig {
  authMode: string;
  requireEmailValidation: boolean;
  requirePhoneValidation: boolean;
  priceSocio: number;
  priceNoSocio: number;
  currency: string;
}

interface AppDB {
  config: AppConfig;
  courts: Court[];
  users: AppUser[];
  sessions: { currentUserId?: string };
  reservations: Reservation[];
  payments: Payment[];
  blocks: Block[];
  audit: AuditEntry[];
  notifications: Notification[];
}

// ─────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────

const LS_KEY = "edlp_tenis_reservas_v1";

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function formatDateISO(d: Date) {
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateHuman(iso: string) {
  const [y, m, d] = iso.split("-").map((v) => parseInt(v, 10));
  const x = new Date(y, m - 1, d);
  return x.toLocaleDateString("es-AR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function nowISOTime() {
  return new Date().toISOString();
}

function safeParseJSON<T>(v: string, fallback: T): T {
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────
// Mock: Validación DNI
// ─────────────────────────────────────────────

async function validateSocioByDNI(dni: string): Promise<{ socioActivo: boolean }> {
  await new Promise((r) => setTimeout(r, 450));
  const last = String(dni || "").trim().slice(-1);
  const n = Number(last);
  const socioActivo = Number.isFinite(n) && n % 2 === 0;
  return { socioActivo };
}

// ─────────────────────────────────────────────
// Dominio
// ─────────────────────────────────────────────

const COURTS_DEFAULT: Court[] = [
  { id: "c1", name: "Cancha 1", isActive: true },
  { id: "c2", name: "Cancha 2", isActive: true },
  { id: "c3", name: "Cancha 3", isActive: true },
  { id: "c4", name: "Cancha 4", isActive: true },
];

const SLOT_TIMES = Array.from({ length: 14 }, (_, i) => {
  const h = 8 + i;
  return `${String(h).padStart(2, "0")}:00`;
});

const RES_STATUS = {
  PENDING_PAYMENT: "Pendiente de pago",
  CONFIRMED: "Confirmada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No presentación",
};

const PAY_STATUS = {
  PENDING: "Pendiente",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  REFUNDED_PARTIAL: "Reembolsado (parcial)",
};

const NOTIF_CHANNELS = ["Email", "WhatsApp Business"];

const APP_CONFIG_DEFAULT: AppConfig = {
  authMode: "EMAIL_PASSWORD",
  requireEmailValidation: true,
  requirePhoneValidation: true,
  priceSocio: 0,
  priceNoSocio: 8000,
  currency: "ARS",
};

// ─────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────

function bootstrapState(): AppDB | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(LS_KEY);
  if (raw) return safeParseJSON<AppDB | null>(raw, null);

  const adminId = uid("usr");
  const seed: AppDB = {
    config: APP_CONFIG_DEFAULT,
    courts: COURTS_DEFAULT,
    users: [
      {
        id: adminId,
        role: "admin",
        email: "admin@edlp.com",
        phone: "11-0000-0000",
        dni: "12345678",
        userType: "Socio",
        createdAt: nowISOTime(),
        passwordHash: "admin",
        isEmailValidated: true,
        isPhoneValidated: true,
      },
    ],
    sessions: {},
    reservations: [],
    payments: [],
    blocks: [],
    audit: [
      {
        id: uid("aud"),
        at: nowISOTime(),
        by: adminId,
        action: "Seed",
        detail: "Sistema inicializado con usuario admin demo (admin@edlp.com / admin)",
      },
    ],
    notifications: [],
  };
  localStorage.setItem(LS_KEY, JSON.stringify(seed));
  return seed;
}

function persistState(state: AppDB) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

// ─────────────────────────────────────────────
// API local
// ─────────────────────────────────────────────

function createApi(db: AppDB, setDb: React.Dispatch<React.SetStateAction<AppDB | null>>) {
  function commit(mutator: (st: AppDB) => AppDB) {
    setDb((prev) => {
      if (!prev) return prev;
      const next = mutator(structuredClone(prev));
      persistState(next);
      return next;
    });
  }

  function audit(by: string, action: string, detail: string) {
    commit((st) => {
      st.audit.unshift({ id: uid("aud"), at: nowISOTime(), by, action, detail });
      return st;
    });
  }

  function notify(event: string, channels: string[], to: string, payload: Record<string, unknown>) {
    commit((st) => {
      const created = channels.map((ch) => ({
        id: uid("ntf"),
        at: nowISOTime(),
        channel: ch,
        to,
        event,
        payload,
      }));
      st.notifications.unshift(...created);
      return st;
    });
  }

  return {
    getConfig: () => db.config,

    setConfig: (by: string, patch: Partial<AppConfig>) => {
      commit((st) => {
        st.config = { ...st.config, ...patch };
        return st;
      });
      audit(by, "Config", JSON.stringify(patch));
    },

    validateSocioByDNI,

    register: async ({ email, phone, dni, password }: { email: string; phone: string; dni: string; password: string }) => {
      const dniClean = String(dni || "").trim();
      const emailClean = String(email || "").trim().toLowerCase();
      const phoneClean = String(phone || "").trim();
      const pass = String(password || "");

      if (!dniClean || dniClean.length < 6) throw new Error("DNI inválido");
      if (!emailClean.includes("@")) throw new Error("Email inválido");
      if (!phoneClean) throw new Error("Teléfono obligatorio");

      const passRegex = /^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{6,}$/;
      if (!passRegex.test(pass)) {
        throw new Error("La contraseña debe tener mínimo 6 caracteres, 1 mayúscula y 1 símbolo (@, -, etc)");
      }

      const exists = db.users.some((u) => u.email === emailClean || u.dni === dniClean);
      if (exists) throw new Error("Ya existe un usuario con ese email o DNI");

      const { socioActivo } = await validateSocioByDNI(dniClean);
      const userType: "Socio" | "No Socio" = socioActivo ? "Socio" : "No Socio";

      const id = uid("usr");
      commit((st) => {
        st.users.push({
          id,
          role: "user",
          email: emailClean,
          phone: phoneClean,
          dni: dniClean,
          userType,
          createdAt: nowISOTime(),
          passwordHash: pass,
          isEmailValidated: false,
          isPhoneValidated: false,
        });
        return st;
      });
      audit(id, "Register", `Alta usuario (${userType})`);
      notify("Validación de cuenta", NOTIF_CHANNELS, emailClean, {
        msg: "Tu cuenta fue creada. Validá email/WhatsApp para reservar.",
      });
      return id;
    },

    loginEmailPassword: async ({ email, password }: { email: string; password: string }) => {
      const e = String(email || "").trim().toLowerCase();
      const u = db.users.find((x) => x.email === e);
      if (!u) throw new Error("Usuario no encontrado");
      if (u.passwordHash !== String(password || "")) throw new Error("Credenciales inválidas");
      audit(u.id, "Login", "Email+Password");
      return u.id;
    },

    validateAccount: (by: string, { emailOk, phoneOk }: { emailOk?: boolean; phoneOk?: boolean }) => {
      commit((st) => {
        const u = st.users.find((x) => x.id === by);
        if (!u) return st;
        if (typeof emailOk === "boolean") u.isEmailValidated = emailOk;
        if (typeof phoneOk === "boolean") u.isPhoneValidated = phoneOk;
        return st;
      });
      audit(by, "Account", `Validación: email=${emailOk ?? "-"}, phone=${phoneOk ?? "-"}`);
      const u = db.users.find((x) => x.id === by);
      if (u) notify("Validación de cuenta", NOTIF_CHANNELS, u.email, { emailOk, phoneOk });
    },

    setCourtActive: (by: string, courtId: string, isActive: boolean) => {
      commit((st) => {
        const c = st.courts.find((x) => x.id === courtId);
        if (c) c.isActive = isActive;
        return st;
      });
      audit(by, "Court", `${courtId} active=${isActive}`);
    },

    addBlock: (by: string, { courtId, dateISO, time, reason }: { courtId: string; dateISO: string; time: string; reason: string }) => {
      const id = uid("blk");
      commit((st) => {
        st.blocks.push({ id, courtId, dateISO, time, reason, createdBy: by, createdAt: nowISOTime() });
        return st;
      });
      audit(by, "Block", `${courtId} ${dateISO} ${time} (${reason || "s/reason"})`);
      return id;
    },

    removeBlock: (by: string, blockId: string) => {
      commit((st) => {
        st.blocks = st.blocks.filter((b) => b.id !== blockId);
        return st;
      });
      audit(by, "Unblock", blockId);
    },

    createReservation: async (
      by: string,
      { dateISO, time, courtId, forUserId }: { dateISO: string; time: string; courtId: string; forUserId?: string }
    ) => {
      const u = db.users.find((x) => x.id === (forUserId || by));
      if (!u) throw new Error("Usuario inválido");

      const cfg = db.config;
      if (cfg.requireEmailValidation && !u.isEmailValidated)
        throw new Error("Debés validar tu email antes de reservar");
      if (cfg.requirePhoneValidation && !u.isPhoneValidated)
        throw new Error("Debés validar tu WhatsApp antes de reservar");

      const today = startOfDay(new Date());
      const target = startOfDay(new Date(dateISO + "T00:00:00"));
      const max = startOfDay(addDays(today, 7));
      if (target < today) throw new Error("No podés reservar en fechas pasadas");
      if (target > max) throw new Error("Solo podés reservar con hasta 7 días de anticipación");

      const c = db.courts.find((x) => x.id === courtId);
      if (!c || !c.isActive) throw new Error("Cancha no disponible");

      const blocked = db.blocks.some(
        (b) => b.courtId === courtId && b.dateISO === dateISO && b.time === time
      );
      if (blocked) throw new Error("Horario bloqueado por mantenimiento");

      const conflictCourt = db.reservations.some(
        (r) => r.courtId === courtId && r.dateISO === dateISO && r.time === time && r.status !== RES_STATUS.CANCELLED
      );
      if (conflictCourt) throw new Error("Ese turno ya está reservado");

      const conflictUser = db.reservations.some(
        (r) => r.userId === u.id && r.dateISO === dateISO && r.time === time && r.status !== RES_STATUS.CANCELLED
      );
      if (conflictUser) throw new Error("Ya tenés una reserva en ese mismo horario");

      const id = uid("res");
      const price = u.userType === "Socio" ? db.config.priceSocio : db.config.priceNoSocio;

      commit((st) => {
        st.reservations.push({
          id,
          userId: u.id,
          createdBy: by,
          dateISO,
          time,
          courtId,
          status: RES_STATUS.PENDING_PAYMENT,
          price,
          createdAt: nowISOTime(),
          updatedAt: nowISOTime(),
        });
        st.payments.push({
          id: uid("pay"),
          reservationId: id,
          method: null,
          status: PAY_STATUS.PENDING,
          amount: price,
          createdAt: nowISOTime(),
          updatedAt: nowISOTime(),
          meta: {},
        });
        return st;
      });

      audit(by, "Reserva", `Creada ${id} (${dateISO} ${time} ${courtId})`);
      notify("Reserva creada", NOTIF_CHANNELS, u.email, { reservationId: id, dateISO, time, courtId, price });
      return id;
    },

    payWithMercadoPago: async (by: string, reservationId: string) => {
      await new Promise((r) => setTimeout(r, 650));
      commit((st) => {
        const r = st.reservations.find((x) => x.id === reservationId);
        const p = st.payments.find((x) => x.reservationId === reservationId);
        if (!r || !p) return st;
        p.method = "Mercado Pago";
        p.status = PAY_STATUS.APPROVED;
        p.updatedAt = nowISOTime();
        p.meta = { mp: { status: "approved", operationId: uid("mp"), at: nowISOTime() } };
        r.status = RES_STATUS.CONFIRMED;
        r.updatedAt = nowISOTime();
        return st;
      });
      audit(by, "Pago", `MP aprobado (res=${reservationId})`);
      const r = db.reservations.find((x) => x.id === reservationId);
      const u = r ? db.users.find((x) => x.id === r.userId) : null;
      if (u) notify("Pago confirmado", NOTIF_CHANNELS, u.email, { reservationId });
      return true;
    },

    registerCashPayment: (by: string, reservationId: string) => {
      commit((st) => {
        const r = st.reservations.find((x) => x.id === reservationId);
        const p = st.payments.find((x) => x.reservationId === reservationId);
        if (!r || !p) return st;
        p.method = "Efectivo (recepción)";
        p.status = PAY_STATUS.APPROVED;
        p.updatedAt = nowISOTime();
        p.meta = { cash: { by, at: nowISOTime() } };
        r.status = RES_STATUS.CONFIRMED;
        r.updatedAt = nowISOTime();
        return st;
      });
      audit(by, "Pago", `Efectivo aprobado (res=${reservationId})`);
      const r = db.reservations.find((x) => x.id === reservationId);
      const u = r ? db.users.find((x) => x.id === r.userId) : null;
      if (u) notify("Pago confirmado", NOTIF_CHANNELS, u.email, { reservationId, method: "cash" });
    },

    cancelReservation: (by: string, reservationId: string, reason: string) => {
      commit((st) => {
        const r = st.reservations.find((x) => x.id === reservationId);
        if (!r) return st;
        r.status = RES_STATUS.CANCELLED;
        r.updatedAt = nowISOTime();
        r.cancelReason = reason || "";
        return st;
      });
      audit(by, "Reserva", `Cancelada ${reservationId} (${reason || "sin motivo"})`);
      const r = db.reservations.find((x) => x.id === reservationId);
      const u = r ? db.users.find((x) => x.id === r.userId) : null;
      if (u) notify("Cancelación", NOTIF_CHANNELS, u.email, { reservationId, reason });
    },

    markNoShowAndRefund50: (by: string, reservationId: string) => {
      commit((st) => {
        const r = st.reservations.find((x) => x.id === reservationId);
        const p = st.payments.find((x) => x.reservationId === reservationId);
        if (!r || !p) return st;
        r.status = RES_STATUS.NO_SHOW;
        r.updatedAt = nowISOTime();
        p.status = PAY_STATUS.REFUNDED_PARTIAL;
        p.updatedAt = nowISOTime();
        p.meta = {
          ...p.meta,
          refund: { percent: 50, amount: Math.round((p.amount || 0) * 0.5), by, at: nowISOTime() },
        };
        return st;
      });
      audit(by, "NoShow", `No presentación + reintegro 50% (res=${reservationId})`);
      const r = db.reservations.find((x) => x.id === reservationId);
      const u = r ? db.users.find((x) => x.id === r.userId) : null;
      if (u) notify("No presentación", NOTIF_CHANNELS, u.email, { reservationId, refundPercent: 50 });
    },

    adminCreateManualReservation: async (
      by: string,
      { userId, dateISO, time, courtId, markPaidCash }: { userId: string; dateISO: string; time: string; courtId: string; markPaidCash: boolean }
    ) => {
      const api = createApi(db, setDb);
      const resId = await api.createReservation(by, { dateISO, time, courtId, forUserId: userId });
      if (markPaidCash) api.registerCashPayment(by, resId);
      audit(by, "Admin", `Reserva manual ${resId}`);
      return resId;
    },
  };
}

type AppApi = ReturnType<typeof createApi>;

// ─────────────────────────────────────────────
// Helpers dominio
// ─────────────────────────────────────────────

function courtName(db: AppDB, courtId: string) {
  return db.courts.find((c) => c.id === courtId)?.name || courtId;
}

function formatMoney(amount: number, currency: string) {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat("es-AR", { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toLocaleString("es-AR")}`;
  }
}

// ─────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────

type PillTone = "default" | "success" | "warning" | "danger" | "info";

function Pill({
  tone = "default",
  children,
  icon: Icon,
}: {
  tone?: PillTone;
  children: React.ReactNode;
  icon?: React.ElementType;
}) {
  const toneCls =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "warning"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : tone === "danger"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : tone === "info"
      ? "bg-sky-50 text-sky-700 border-sky-200"
      : "bg-muted text-foreground border-border";

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${toneCls}`}>
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      <span className="leading-none">{children}</span>
    </span>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  subtitle,
  right,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-2xl border bg-card p-2 shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="text-lg font-semibold leading-tight">{title}</div>
          {subtitle ? <div className="text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
      </div>
      {right}
    </div>
  );
}

function TopBar({ user, onLogout }: { user: AppUser | null; onLogout: () => void }) {
  return (
    <div className="sticky top-0 z-30 border-b bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/6/68/Escudo_del_Club_Estudiantes_de_La_Plata.svg"
            alt="Escudo Estudiantes"
            className="h-10 w-10 object-contain"
          />
          <div>
            <div className="text-sm font-semibold leading-tight">Club Estudiantes de La Plata</div>
            <div className="text-xs text-muted-foreground">Reserva de canchas de tenis</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Badge variant="secondary" className="rounded-full">
                {user.role === "admin" ? "Admin" : user.userType}
              </Badge>
              <div className="hidden text-sm text-muted-foreground md:block">{user.email}</div>
              <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={onLogout}>
                <LogOut className="mr-2 h-4 w-4" /> Salir
              </Button>
            </>
          ) : (
            <Badge variant="secondary" className="rounded-full">
              Demo
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function BottomNav({
  active,
  setActive,
  isAdmin,
}: {
  active: string;
  setActive: (v: string) => void;
  isAdmin: boolean;
}) {
  const items = [
    { key: "reservar", label: "Reservar", icon: Calendar },
    { key: "mis", label: "Mis reservas", icon: Clock },
    { key: "perfil", label: "Perfil", icon: User },
    ...(isAdmin ? [{ key: "admin", label: "Admin", icon: Shield }] : []),
  ];
  const gridCols = isAdmin ? "grid-cols-4" : "grid-cols-3";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/80 backdrop-blur">
      <div className={`mx-auto grid w-full max-w-6xl ${gridCols} gap-2 px-3 py-2`}>
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => setActive(it.key)}
            className={`flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-sm transition-all ${
              active === it.key ? "bg-muted font-semibold" : "hover:bg-muted/60"
            }`}
          >
            <it.icon className="h-4 w-4" />
            <span className="truncate">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InlineError({ msg }: { msg: string }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
      <AlertTriangle className="mt-0.5 h-4 w-4" />
      <div>{msg}</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// App principal
// ─────────────────────────────────────────────

export default function TenisApp() {
  const [mounted, setMounted] = useState(false);
  const [db, setDb] = useState<AppDB | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("reservar");
  const [authScreen, setAuthScreen] = useState<"login" | "register" | null>(null);

  // Derivados – definidos ANTES de cualquier useEffect que los use
  const user = useMemo(
    () => db?.users?.find((u) => u.id === sessionUserId) || null,
    [db, sessionUserId]
  );
  const api = useMemo(() => (db ? createApi(db, setDb) : null), [db]);
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    setMounted(true);
    const initialDb = bootstrapState();
    setDb(initialDb);
    setSessionUserId(initialDb?.sessions?.currentUserId ?? null);
  }, []);

  useEffect(() => {
    if (!db) return;
    setDb((prev) => {
      if (!prev) return prev;
      const next = { ...prev, sessions: { ...prev.sessions, currentUserId: sessionUserId ?? undefined } };
      persistState(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUserId]);

  useEffect(() => {
    if (!user) setActiveTab("reservar");
  }, [user]);

  useEffect(() => {
    function handler() {
      setActiveTab("mis");
    }
    document.addEventListener("go-to-mis", handler);
    return () => document.removeEventListener("go-to-mis", handler);
  }, []);

  if (!mounted || !db) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p>Cargando...</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${!user && !authScreen ? "bg-gradient-to-br from-red-700 via-red-600 to-red-800" : "bg-background"}`}>
      <TopBar user={user} onLogout={() => setSessionUserId(null)} />

      <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">
        <AnimatePresence mode="wait" initial={false}>
          {!user ? (
            authScreen ? (
              <AuthGate
                key="auth"
                api={api!}
                mode={authScreen}
                onAuthed={(id) => {
                  setSessionUserId(id);
                  setAuthScreen(null);
                }}
                onBack={() => setAuthScreen(null)}
              />
            ) : (
              <motion.div
                key="landing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center gap-6 py-16 text-center"
              >
                <div className="flex h-40 w-40 items-center justify-center rounded-3xl bg-white p-4 shadow-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://upload.wikimedia.org/wikipedia/commons/6/68/Escudo_del_Club_Estudiantes_de_La_Plata.svg"
                    alt="Escudo"
                    className="h-full w-full object-contain"
                  />
                </div>
                <div>
                  <div className="text-3xl font-bold tracking-tight text-white">Club Estudiantes de La Plata</div>
                  <div className="mt-2 text-base font-medium text-white/90">Sistema Oficial de Reserva de Tenis</div>
                </div>
                <div className="mt-6 flex w-full max-w-xs flex-col gap-4">
                  <Button className="w-full rounded-2xl bg-white text-red-700 hover:bg-red-50" onClick={() => setAuthScreen("login")}>
                    Ingresar
                  </Button>
                  <Button className="w-full rounded-2xl bg-white text-red-700 hover:bg-red-50" onClick={() => setAuthScreen("register")}>
                    Crear cuenta
                  </Button>
                </div>
                <div className="mt-4 rounded-2xl border border-white/20 bg-white/10 p-3 text-xs text-white/80">
                  Demo: <span className="font-semibold">admin@edlp.com</span> / <span className="font-semibold">admin</span>
                </div>
              </motion.div>
            )
          ) : (
            <>
              {activeTab === "reservar" && (
                <motion.div key="reservar" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
                  <BookingView api={api!} db={db} user={user} />
                </motion.div>
              )}
              {activeTab === "mis" && (
                <motion.div key="mis" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
                  <MyReservations api={api!} db={db} user={user} goToReservar={() => setActiveTab("reservar")} />
                </motion.div>
              )}
              {activeTab === "perfil" && (
                <motion.div key="perfil" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
                  <ProfileView api={api!} db={db} user={user} />
                </motion.div>
              )}
              {activeTab === "admin" && isAdmin && (
                <motion.div key="admin" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}>
                  <AdminView api={api!} db={db} user={user} />
                </motion.div>
              )}
            </>
          )}
        </AnimatePresence>
      </div>

      {user && <BottomNav active={activeTab} setActive={setActiveTab} isAdmin={isAdmin} />}
    </div>
  );
}

// ─────────────────────────────────────────────
// AuthGate
// ─────────────────────────────────────────────

function AuthGate({
  api,
  onAuthed,
  mode = "login",
  onBack,
}: {
  api: AppApi;
  onAuthed: (uid: string) => void;
  mode: "login" | "register";
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [dni, setDni] = useState("");
  const [phone, setPhone] = useState("");
  const [showReset, setShowReset] = useState(false);

  const passwordValid = /^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{6,}$/.test(password);
  const emailValid = email.includes("@");
  const dniValid = dni.trim().length >= 6;
  const phoneValid = phone.trim().length > 0;
  const canRegister = passwordValid && emailValid && dniValid && phoneValid && !busy;

  async function doLogin() {
    setErr("");
    setBusy(true);
    try {
      const id = await api.loginEmailPassword({ email, password });
      onAuthed(id);
    } catch (e) {
      setErr((e as Error)?.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  async function doRegister() {
    setErr("");
    setBusy(true);
    try {
      const id = await api.register({ email, phone, dni, password });
      onAuthed(id);
    } catch (e) {
      setErr((e as Error)?.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      key="authgate"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="mx-auto max-w-md"
    >
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{mode === "login" ? "Ingresar" : "Crear cuenta"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {mode === "login" ? (
            <form onSubmit={(e) => { e.preventDefault(); if (!busy) doLogin(); }}>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input className="rounded-2xl" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@mail.com" />
              </div>
              <div className="mt-4 grid gap-2">
                <Label>Password</Label>
                <Input className="rounded-2xl" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="mt-2 text-right">
                <button type="button" onClick={() => setShowReset(!showReset)} className="text-xs text-muted-foreground hover:underline">
                  Olvidé mi contraseña
                </button>
              </div>
              {showReset && (
                <div className="mt-2 rounded-2xl border bg-muted/30 p-3 text-xs text-muted-foreground">
                  En producción: envío de email de recuperación.
                </div>
              )}
              {err && <div className="mt-2"><InlineError msg={err} /></div>}
              <Button type="submit" className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl" disabled={busy}>
                {busy ? "Procesando…" : "Entrar"}
              </Button>
            </form>
          ) : (
            <>
              <div className="grid gap-2">
                <Label>DNI</Label>
                <Input className="rounded-2xl" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="12345678" />
              </div>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input className="rounded-2xl" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@mail.com" />
              </div>
              <div className="grid gap-2">
                <Label>Teléfono</Label>
                <Input className="rounded-2xl" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11-1234-5678" />
              </div>
              <div className="grid gap-2">
                <Label>Password</Label>
                <Input className="rounded-2xl" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mín 6 chars, 1 mayúscula y 1 símbolo" />
                <div className="text-xs text-muted-foreground">Mínimo 6 caracteres, al menos 1 mayúscula y 1 símbolo.</div>
              </div>
              {err && <InlineError msg={err} />}
              <Button className="w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={doRegister} disabled={!canRegister}>
                {busy ? "Creando…" : "Crear cuenta"}
              </Button>
            </>
          )}
          <Button variant="ghost" className="w-full rounded-2xl" onClick={onBack}>
            Volver
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ─────────────────────────────────────────────
// Booking
// ─────────────────────────────────────────────

function PolicyBanner() {
  return (
    <div className="rounded-2xl border bg-amber-50 p-3 text-xs text-amber-700">
      <span className="font-semibold">Política de cancelación:</span> cancelaciones con más de 24h → reintegro total.
      No presentación → reintegro 50%.
    </div>
  );
}

function BookingView({ api, db, user }: { api: AppApi; db: AppDB; user: AppUser }) {
  const [dateISO, setDateISO] = useState(() => formatDateISO(new Date()));
  const [time, setTime] = useState(SLOT_TIMES[0]);
  const [courtId, setCourtId] = useState("c1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [createdResId, setCreatedResId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const cfg = db.config;
  const maxDateISO = useMemo(() => formatDateISO(addDays(startOfDay(new Date()), 7)), []);
  const courts = db.courts;

  const availability = useMemo(() => {
    const res = db.reservations.filter((r) => r.dateISO === dateISO && r.time === time && r.status !== RES_STATUS.CANCELLED);
    const blocks = db.blocks.filter((b) => b.dateISO === dateISO && b.time === time);
    const byCourt = new Map<string, { isActive: boolean; status: string }>();
    for (const c of courts) {
      const isBlocked = blocks.some((b) => b.courtId === c.id);
      const isReserved = res.some((r) => r.courtId === c.id);
      byCourt.set(c.id, {
        isActive: c.isActive,
        status: !c.isActive ? "Inactiva" : isBlocked ? "Mantenimiento" : isReserved ? "Ocupada" : "Disponible",
      });
    }
    return byCourt;
  }, [db.blocks, db.reservations, courts, dateISO, time]);

  async function createReservation() {
    setErr("");
    setBusy(true);
    try {
      const id = await api.createReservation(user.id, { dateISO, time, courtId });
      setCreatedResId(id);
      setPayOpen(true);
    } catch (e) {
      setErr((e as Error)?.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  const price = user.userType === "Socio" ? cfg.priceSocio : cfg.priceNoSocio;
  const selectedStatus = availability.get(courtId)?.status;

  return (
    <div className="grid gap-4">
      <SectionTitle
        icon={Calendar}
        title="Reservar cancha"
        subtitle="Turnos de 60 minutos. Anticipación máxima: 7 días."
        right={<Pill tone="info" icon={Bell}>Email + WhatsApp</Pill>}
      />

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="grid gap-4 p-4 md:grid-cols-4">
          <div className="grid gap-2">
            <Label>Fecha</Label>
            <Input className="rounded-2xl" type="date" value={dateISO} min={formatDateISO(new Date())} max={maxDateISO} onChange={(e) => setDateISO(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Horario</Label>
            <Select value={time} onValueChange={setTime}>
              <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SLOT_TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Cancha</Label>
            <Select value={courtId} onValueChange={setCourtId}>
              <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {courts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Disponibilidad</Label>
            <div className="flex h-10 items-center">
              <Pill
                tone={
                  selectedStatus === "Disponible" ? "success" : selectedStatus === "Ocupada" ? "danger" : "warning"
                }
              >
                {selectedStatus || "—"}
              </Pill>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
        {courts.map((c) => {
          const info = availability.get(c.id);
          return (
            <button
              key={c.id}
              onClick={() => setCourtId(c.id)}
              className={`rounded-2xl border p-4 text-left shadow-sm transition-all ${
                courtId === c.id ? "border-red-500 bg-red-50 ring-2 ring-red-500" : "bg-card hover:border-red-300"
              }`}
            >
              <div className="text-sm font-semibold">{c.name}</div>
              <div className="mt-1">
                <Pill tone={info?.status === "Disponible" ? "success" : info?.status === "Ocupada" ? "danger" : "warning"}>
                  {info?.status}
                </Pill>
              </div>
            </button>
          );
        })}
      </div>

      <PolicyBanner />

      {err && <InlineError msg={err} />}

      <div className="flex items-center justify-between rounded-2xl border bg-card p-4 shadow-sm">
        <div>
          <div className="text-sm text-muted-foreground">Total a pagar</div>
          <div className="text-xl font-bold">{formatMoney(price, cfg.currency)}</div>
          <div className="text-xs text-muted-foreground">{user.userType}</div>
        </div>
        <Button
          className="bg-red-600 hover:bg-red-700 text-white rounded-2xl"
          onClick={createReservation}
          disabled={busy || selectedStatus !== "Disponible"}
        >
          {busy ? "Reservando…" : "Reservar"}
        </Button>
      </div>

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        api={api}
        db={db}
        user={user}
        reservationId={createdResId}
        onSuccess={() => {
          setPayOpen(false);
          document.dispatchEvent(new CustomEvent("go-to-mis"));
        }}
      />
    </div>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  api,
  db,
  user,
  reservationId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  api: AppApi;
  db: AppDB;
  user: AppUser;
  reservationId: string | null;
  onSuccess?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState(false);

  const reservation = reservationId ? db.reservations.find((r) => r.id === reservationId) : null;
  const payment = reservationId ? db.payments.find((p) => p.reservationId === reservationId) : null;

  async function payMP() {
    if (!reservationId) return;
    setErr("");
    setBusy(true);
    try {
      await api.payWithMercadoPago(user.id, reservationId);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setTimeout(() => {
          onOpenChange(false);
          if (onSuccess) onSuccess();
        }, 300);
      }, 3000);
    } catch (e) {
      setErr((e as Error)?.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle>Confirmar pago</DialogTitle>
          <DialogDescription>La reserva queda pendiente hasta que el pago esté aprobado.</DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {success ? (
            <motion.div key="ok" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-800">
              <CheckCircle2 className="h-8 w-8" />
              <div className="text-base font-semibold">Pago confirmado</div>
              <div className="text-sm text-emerald-900/80">Tu reserva fue confirmada.</div>
            </motion.div>
          ) : !reservation ? (
            <div className="text-sm text-muted-foreground">No hay reserva seleccionada.</div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
              <div className="rounded-2xl border bg-muted/30 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">Reserva</div>
                  <Badge variant="secondary" className="rounded-full">{reservation.status}</Badge>
                </div>
                <div className="mt-1 text-muted-foreground">{formatDateHuman(reservation.dateISO)} · {reservation.time} · {courtName(db, reservation.courtId)}</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-muted-foreground">Total</div>
                  <div className="font-semibold">{formatMoney(reservation.price, db.config.currency)}</div>
                </div>
              </div>
              <PolicyBanner />
              <div className="rounded-2xl border bg-card p-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  <div className="text-sm font-semibold">Mercado Pago (online)</div>
                  <Pill tone="info">Demo</Pill>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">En demo: aprobación inmediata.</div>
                <Button className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={payMP} disabled={busy || reservation.status !== RES_STATUS.PENDING_PAYMENT}>
                  {busy ? "Procesando…" : "Pagar con Mercado Pago"}
                </Button>
              </div>
              {payment && <div className="text-xs text-muted-foreground">Estado pago: <span className="font-medium text-foreground">{payment.status}</span></div>}
              {err && <InlineError msg={err} />}
            </motion.div>
          )}
        </AnimatePresence>

        {!success && (
          <DialogFooter>
            <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => onOpenChange(false)}>Cerrar</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────
// Mis Reservas
// ─────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const tone: PillTone =
    status === RES_STATUS.CONFIRMED ? "success" : status === RES_STATUS.PENDING_PAYMENT ? "warning" : status === RES_STATUS.NO_SHOW ? "danger" : "default";
  const icon =
    status === RES_STATUS.CONFIRMED ? CheckCircle2 : status === RES_STATUS.PENDING_PAYMENT ? AlertTriangle : status === RES_STATUS.NO_SHOW ? XCircle : undefined;
  return <Pill tone={tone} icon={icon}>{status}</Pill>;
}

function MyReservations({ api, db, user, goToReservar }: { api: AppApi; db: AppDB; user: AppUser; goToReservar: () => void }) {
  const [q, setQ] = useState("");
  const [selectedResId, setSelectedResId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const mine = useMemo(
    () =>
      db.reservations
        .filter((r) => r.userId === user.id && r.status !== RES_STATUS.CANCELLED)
        .sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time)),
    [db.reservations, user.id]
  );

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return mine;
    return mine.filter((r) => `${r.dateISO} ${r.time} ${courtName(db, r.courtId)} ${r.status}`.toLowerCase().includes(qq));
  }, [mine, q, db]);

  return (
    <div className="grid gap-4">
      <SectionTitle
        icon={Clock}
        title="Mis reservas"
        subtitle="Seguimiento de estados."
        right={
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input className="w-48 rounded-2xl" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" />
          </div>
        }
      />

      {filtered.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center shadow-sm">
          <Calendar className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <div className="text-base font-semibold">No tenés reservas</div>
          <div className="mt-1 text-sm text-muted-foreground">Creá una desde Reservar.</div>
          <div className="mt-4 flex justify-center">
            <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={goToReservar}>Ir a reservar</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((r) => {
            const p = db.payments.find((x) => x.reservationId === r.id);
            return (
              <Card key={r.id} className="rounded-2xl shadow-sm">
                <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold">{formatDateHuman(r.dateISO)} · {r.time}</div>
                      <Badge variant="secondary" className="rounded-full">{courtName(db, r.courtId)}</Badge>
                      <StatusPill status={r.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Pago: <span className="font-medium text-foreground">{p?.status || "-"}</span> · Total: {formatMoney(r.price, db.config.currency)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {r.status === RES_STATUS.PENDING_PAYMENT && (
                      <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => { setSelectedResId(r.id); setPayOpen(true); }}>
                        Pagar
                      </Button>
                    )}
                    {r.status !== RES_STATUS.CANCELLED && (
                      <Button variant="outline" className="rounded-2xl" onClick={() => api.cancelReservation(user.id, r.id, "Cancelación por usuario")}>
                        Cancelar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        api={api}
        db={db}
        user={user}
        reservationId={selectedResId}
        onSuccess={() => { setPayOpen(false); window.scrollTo({ top: 0, behavior: "smooth" }); }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// Perfil
// ─────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium">{value || "-"}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border bg-card p-3 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function ProfileView({ api, db, user }: { api: AppApi; db: AppDB; user: AppUser }) {
  const cfg = db.config;
  const needsEmail = cfg.requireEmailValidation && !user.isEmailValidated;
  const needsPhone = cfg.requirePhoneValidation && !user.isPhoneValidated;

  return (
    <div className="grid gap-4">
      <SectionTitle
        icon={User}
        title="Perfil"
        subtitle="Datos y validación de cuenta."
        right={<Pill tone={user.userType === "Socio" ? "success" : "info"}>{user.userType}</Pill>}
      />

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Datos personales</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <InfoRow label="Email" value={user.email} />
          <InfoRow label="Teléfono" value={user.phone} />
          <InfoRow label="DNI" value={user.dni} />
          <InfoRow label="Tipo" value={user.userType} />
          <div className="md:col-span-2">
            <div className="rounded-2xl border bg-muted/30 p-4 text-xs text-muted-foreground">
              Si algún dato es incorrecto, comuniquese con el área de Socios.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Validación de cuenta</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={user.isEmailValidated ? "success" : "warning"} icon={user.isEmailValidated ? CheckCircle2 : AlertTriangle}>
              Email {user.isEmailValidated ? "validado" : "pendiente"}
            </Pill>
            <Pill tone={user.isPhoneValidated ? "success" : "warning"} icon={user.isPhoneValidated ? CheckCircle2 : AlertTriangle}>
              WhatsApp {user.isPhoneValidated ? "validado" : "pendiente"}
            </Pill>
          </div>
          {needsEmail || needsPhone ? (
            <div className="rounded-2xl border bg-card p-4">
              <div className="text-sm font-semibold">Completar validación</div>
              <div className="mt-1 text-sm text-muted-foreground">Sin validar no podés reservar ni pagar.</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {needsEmail && (
                  <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => api.validateAccount(user.id, { emailOk: true })}>
                    Validar email (demo)
                  </Button>
                )}
                {needsPhone && (
                  <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => api.validateAccount(user.id, { phoneOk: true })}>
                    Validar WhatsApp (demo)
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <div>
                  <div className="font-semibold">Cuenta validada</div>
                  <div className="text-emerald-900/80">Ya podés reservar y pagar.</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Actividad</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2 md:grid-cols-2">
            <Stat label="Reservas" value={db.reservations.filter((r) => r.userId === user.id).length} />
            <Stat label="Notificaciones" value={db.notifications.filter((n) => n.to === user.email).length} />
          </div>
          <div className="rounded-2xl border bg-muted/30 p-3 text-xs text-muted-foreground">
            Las notificaciones se registran internamente. En producción se envían por Email y WhatsApp Business.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────

function AdminView({ api, db, user }: { api: AppApi; db: AppDB; user: AppUser }) {
  const [view, setView] = useState("agenda");

  return (
    <div className="grid gap-4">
      <SectionTitle
        icon={Shield}
        title="Administración"
        subtitle="Agenda, reservas manuales, pagos en efectivo, bloqueos, historial y auditoría."
        right={<Pill tone="info" icon={Settings}>Roles + Logs</Pill>}
      />

      <Tabs value={view} onValueChange={setView}>
        <TabsList className="grid w-full grid-cols-2 rounded-2xl md:grid-cols-4">
          <TabsTrigger value="agenda">Agenda</TabsTrigger>
          <TabsTrigger value="operaciones">Operaciones</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
        </TabsList>

        <TabsContent value="agenda" className="mt-4">
          <AdminAgenda api={api} db={db} admin={user} />
        </TabsContent>
        <TabsContent value="operaciones" className="mt-4">
          <AdminOperaciones api={api} db={db} admin={user} />
        </TabsContent>
        <TabsContent value="historial" className="mt-4">
          <AdminHistory db={db} />
        </TabsContent>
        <TabsContent value="config" className="mt-4">
          <AdminConfig api={api} db={db} admin={user} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AdminAgenda({ db }: { api: AppApi; db: AppDB; admin: AppUser }) {
  const [dateISO, setDateISO] = useState(() => formatDateISO(new Date()));

  const dayReservations = useMemo(
    () => db.reservations.filter((r) => r.dateISO === dateISO).sort((a, b) => a.time.localeCompare(b.time)),
    [db.reservations, dateISO]
  );

  return (
    <div className="grid gap-4">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Agenda del día</CardTitle>
            <Input className="w-44 rounded-2xl" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {dayReservations.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sin reservas para este día.</div>
          ) : (
            <div className="overflow-auto rounded-2xl border">
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    {["Horario", "Cancha", "Usuario", "Estado", "Pago", "Total"].map((c) => (
                      <th key={c} className="p-3 text-left text-xs font-semibold">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayReservations.map((r) => {
                    const u = db.users.find((x) => x.id === r.userId);
                    const p = db.payments.find((x) => x.reservationId === r.id);
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="p-3 text-xs">{r.time}</td>
                        <td className="p-3 text-xs">{courtName(db, r.courtId)}</td>
                        <td className="p-3 text-xs">{u?.email || "-"}</td>
                        <td className="p-3 text-xs"><StatusPill status={r.status} /></td>
                        <td className="p-3 text-xs">{p?.status || "-"}</td>
                        <td className="p-3 text-xs">{formatMoney(r.price, db.config.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AdminOperaciones({ api, db, admin }: { api: AppApi; db: AppDB; admin: AppUser }) {
  const [dateISO, setDateISO] = useState(() => formatDateISO(new Date()));
  const [time, setTime] = useState(SLOT_TIMES[0]);
  const [courtId, setCourtId] = useState("c1");
  const [userId, setUserId] = useState("");
  const [markPaidCash, setMarkPaidCash] = useState(false);
  const [reason, setReason] = useState("");
  const [selectedResId, setSelectedResId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const eligibleUsers = db.users.filter((u) => u.role !== "admin");
  const dayReservations = useMemo(
    () => db.reservations.filter((r) => r.dateISO === dateISO).sort((a, b) => a.time.localeCompare(b.time)),
    [db.reservations, dateISO]
  );

  async function createManual() {
    if (!userId) { setErr("Seleccioná un usuario"); return; }
    setErr("");
    setBusy(true);
    try {
      await api.adminCreateManualReservation(admin.id, { userId, dateISO, time, courtId, markPaidCash });
    } catch (e) {
      setErr((e as Error)?.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Reserva manual</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <Label>Usuario</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Elegí un usuario" /></SelectTrigger>
              <SelectContent>
                {eligibleUsers.map((u) => <SelectItem key={u.id} value={u.id}>{u.email} ({u.userType})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Fecha</Label>
            <Input className="rounded-2xl" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label>Horario</Label>
              <Select value={time} onValueChange={setTime}>
                <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SLOT_TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Cancha</Label>
              <Select value={courtId} onValueChange={setCourtId}>
                <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {db.courts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-2xl border bg-card p-3">
            <div className="text-sm font-semibold">Registrar pago en efectivo</div>
            <Switch className="data-[state=checked]:bg-red-600 data-[state=unchecked]:bg-red-200" checked={markPaidCash} onCheckedChange={setMarkPaidCash} />
          </div>
          {err && <InlineError msg={err} />}
          <Button className="w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={createManual} disabled={busy || eligibleUsers.length === 0}>
            {busy ? "Creando…" : "Crear reserva"}
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Bloquear cancha / horario</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-2">
              <Label>Fecha</Label>
              <Input className="rounded-2xl" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Horario</Label>
              <Select value={time} onValueChange={setTime}>
                <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent>{SLOT_TIMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Cancha</Label>
              <Select value={courtId} onValueChange={setCourtId}>
                <SelectTrigger className="rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent>{db.courts.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Motivo</Label>
            <Input className="rounded-2xl" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mantenimiento" />
          </div>
          <Button className="w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => { api.addBlock(admin.id, { courtId, dateISO, time, reason: reason || "Mantenimiento" }); setReason(""); }}>
            <Wrench className="mr-2 h-4 w-4" /> Bloquear
          </Button>
          <Separator />
          <div className="text-sm font-semibold">Bloqueos existentes</div>
          <div className="grid gap-2">
            {db.blocks.length === 0 ? (
              <div className="text-sm text-muted-foreground">Sin bloqueos.</div>
            ) : (
              db.blocks
                .slice()
                .sort((a, b) => (a.dateISO + a.time).localeCompare(b.dateISO + b.time))
                .map((b) => (
                  <div key={b.id} className="flex items-center justify-between rounded-2xl border bg-card p-3 text-sm">
                    <div>
                      <div className="font-semibold">{courtName(db, b.courtId)} · {formatDateHuman(b.dateISO)} · {b.time}</div>
                      <div className="text-xs text-muted-foreground">{b.reason || "-"}</div>
                    </div>
                    <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => api.removeBlock(admin.id, b.id)}>Quitar</Button>
                  </div>
                ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm md:col-span-2">
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">Operaciones sobre reservas</CardTitle>
            <Input className="w-44 rounded-2xl" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2">
            <Label>Reserva</Label>
            <Select value={selectedResId || "none"} onValueChange={(v) => setSelectedResId(v === "none" ? null : v)}>
              <SelectTrigger className="rounded-2xl"><SelectValue placeholder="Elegí una reserva" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">-</SelectItem>
                {dayReservations.map((r) => {
                  const u = db.users.find((x) => x.id === r.userId);
                  return <SelectItem key={r.id} value={r.id}>{r.time} · {courtName(db, r.courtId)} · {u?.email || "-"} · {r.status}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          {selectedResId ? (
            <AdminReservationActions api={api} db={db} admin={admin} reservationId={selectedResId} />
          ) : (
            <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">Elegí una reserva para operar.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AdminReservationActions({ api, db, admin, reservationId }: { api: AppApi; db: AppDB; admin: AppUser; reservationId: string }) {
  const reservation = db.reservations.find((r) => r.id === reservationId);
  const payment = db.payments.find((p) => p.reservationId === reservationId);
  const u = reservation ? db.users.find((x) => x.id === reservation.userId) : null;

  if (!reservation) return null;

  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{formatDateHuman(reservation.dateISO)} · {reservation.time} · {courtName(db, reservation.courtId)}</div>
          <div className="text-xs text-muted-foreground">Usuario: {u?.email || "-"} ({u?.userType || "-"})</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={reservation.status} />
          <Pill tone={payment?.status === PAY_STATUS.APPROVED ? "success" : "warning"}>Pago: {payment?.status || "-"}</Pill>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => api.registerCashPayment(admin.id, reservationId)} disabled={reservation.status !== RES_STATUS.PENDING_PAYMENT}>
          Registrar efectivo
        </Button>
        <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => api.cancelReservation(admin.id, reservationId, "Cancelación admin")} disabled={reservation.status === RES_STATUS.CANCELLED}>
          Cancelar
        </Button>
        <Button className="bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => api.markNoShowAndRefund50(admin.id, reservationId)} disabled={reservation.status !== RES_STATUS.CONFIRMED}>
          No show + 50%
        </Button>
      </div>
      <div className="text-xs text-muted-foreground">
        Total: <span className="font-medium text-foreground">{formatMoney(reservation.price, db.config.currency)}</span>
        {payment?.method && <span> · Método: <span className="font-medium text-foreground">{payment.method}</span></span>}
      </div>
    </div>
  );
}

function AdminHistory({ db }: { db: AppDB }) {
  const [tab, setTab] = useState("audit");

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle className="text-base">Historial</CardTitle></CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-4 rounded-2xl">
            <TabsTrigger value="audit">Auditoría</TabsTrigger>
            <TabsTrigger value="notifs">Notificaciones</TabsTrigger>
            <TabsTrigger value="reservas">Reservas</TabsTrigger>
            <TabsTrigger value="pagos">Pagos</TabsTrigger>
          </TabsList>
          <TabsContent value="audit" className="mt-4">
            <ListTable cols={["Fecha", "Usuario", "Acción", "Detalle"]} rows={db.audit.slice(0, 80).map((a) => [new Date(a.at).toLocaleString("es-AR"), db.users.find((u) => u.id === a.by)?.email || a.by, a.action, a.detail])} />
          </TabsContent>
          <TabsContent value="notifs" className="mt-4">
            <ListTable cols={["Fecha", "Canal", "Destino", "Evento"]} rows={db.notifications.slice(0, 80).map((n) => [new Date(n.at).toLocaleString("es-AR"), n.channel, n.to, n.event])} />
          </TabsContent>
          <TabsContent value="reservas" className="mt-4">
            <ListTable
              cols={["Fecha", "Horario", "Cancha", "Usuario", "Estado"]}
              rows={db.reservations.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 80).map((r) => [formatDateHuman(r.dateISO), r.time, courtName(db, r.courtId), db.users.find((u) => u.id === r.userId)?.email || "-", r.status])}
            />
          </TabsContent>
          <TabsContent value="pagos" className="mt-4">
            <ListTable
              cols={["Reserva", "Método", "Estado", "Monto"]}
              rows={db.payments.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 80).map((p) => [p.reservationId, p.method || "-", p.status, formatMoney(p.amount, db.config.currency)])}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ListTable({ cols, rows }: { cols: string[]; rows: string[][] }) {
  return (
    <div className="overflow-auto rounded-2xl border">
      <table className="w-full min-w-[600px] text-sm">
        <thead className="bg-muted/30">
          <tr>{cols.map((c) => <th key={c} className="p-3 text-left text-xs font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((cell, j) => <td key={j} className="p-3 text-xs text-muted-foreground"><span className="text-foreground">{cell}</span></td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminConfig({ api, db, admin }: { api: AppApi; db: AppDB; admin: AppUser }) {
  const cfg = db.config;
  const [reqEmail, setReqEmail] = useState(cfg.requireEmailValidation);
  const [priceSocio, setPriceSocio] = useState(cfg.priceSocio);
  const [priceNoSocio, setPriceNoSocio] = useState(cfg.priceNoSocio);

  useEffect(() => {
    setReqEmail(cfg.requireEmailValidation);
    setPriceSocio(cfg.priceSocio);
    setPriceNoSocio(cfg.priceNoSocio);
  }, [cfg]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Autenticación</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border bg-muted/30 p-4 text-sm text-muted-foreground">
            Sistema usa <span className="font-semibold text-foreground">Email + Password</span>.
          </div>
          <div className="flex items-center justify-between rounded-2xl border bg-card p-3">
            <div className="text-sm">
              <div className="font-semibold">Validación de email obligatoria</div>
              <div className="text-xs text-muted-foreground">Sin validar, no reserva ni paga</div>
            </div>
            <Switch className="data-[state=checked]:bg-red-600 data-[state=unchecked]:bg-red-200" checked={reqEmail} onCheckedChange={setReqEmail} />
          </div>
          <Button className="w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => api.setConfig(admin.id, { requireEmailValidation: reqEmail })}>
            Guardar
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Precios</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Socio (ARS)</Label>
            <Input className="rounded-2xl" type="number" value={priceSocio} onChange={(e) => setPriceSocio(clamp(parseInt(e.target.value || "0", 10) || 0, 0, 1000000))} />
          </div>
          <div className="grid gap-2">
            <Label>No socio (ARS)</Label>
            <Input className="rounded-2xl" type="number" value={priceNoSocio} onChange={(e) => setPriceNoSocio(clamp(parseInt(e.target.value || "0", 10) || 0, 0, 1000000))} />
          </div>
          <Button className="w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl" onClick={() => api.setConfig(admin.id, { priceSocio, priceNoSocio })}>
            Guardar
          </Button>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm md:col-span-2">
        <CardHeader><CardTitle className="text-base">Canchas</CardTitle></CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-2">
          {db.courts.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-2xl border bg-card p-3">
              <div className="text-sm">
                <div className="font-semibold">{c.name}</div>
                <div className="text-xs text-muted-foreground">Una reserva por horario</div>
              </div>
              <Switch className="data-[state=checked]:bg-red-600 data-[state=unchecked]:bg-red-200" checked={c.isActive} onCheckedChange={(v) => api.setCourtActive(admin.id, c.id, v)} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
