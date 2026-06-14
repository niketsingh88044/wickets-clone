import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type Role = "USER" | "MASTER" | "SUPER_MASTER";

export interface AuthedRequest extends Request {
  userId?: string;
  role?: Role;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing bearer token" });
  }
  const token = header.slice("Bearer ".length);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string; role: Role };
    req.userId = decoded.sub;
    req.role = decoded.role;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.role || !roles.includes(req.role)) {
      return res.status(403).json({ error: "forbidden: requires " + roles.join(" or ") });
    }
    next();
  };
}
