import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";
import "./auth.css";

export const metadata: Metadata = {
  title: "Login / Sign Up — Clinic",
  description: "Login or create your Cinic account",
};

export default function LoginPage() {
  return <AuthForm />;
}
