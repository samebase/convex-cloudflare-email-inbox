import { defineApp } from "convex/server";
import mail from "./components/mail/convex.config.js";

const app = defineApp();

app.use(mail);

export default app;
