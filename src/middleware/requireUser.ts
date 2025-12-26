import type { Request, Response, NextFunction } from "express";
import { User } from "../models/User";
import { clerkClient, getAuth } from "@clerk/express";

function normalizeEmail(email: string) {
    return email.toLocaleLowerCase().trim();
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
    try {
        // Dev bypass
        if (process.env.NODE_ENV !== "production") { // use the config script
            const devEmail = req.header("X-DEV-EMAIL");

            if (devEmail) {
                const email = normalizeEmail(devEmail);

                let user = await User.findOne({ primaryEmail: email });
                if (!user) {
                    user = await User.create({
                        primaryEmail: email,
                        name: email.split("@")[0],
                        plan: "free",
                        onboardingCompleted: false,
                        connectedInboxes: [],
                    });
                }

                req.userId = user._id.toString();
                return next();
            }
        }

        // Clerk Auth for later
        const { userId: clerkUserId } = getAuth(req);
        if (!clerkUserId) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const clerkUser = await clerkClient.users.getUser(clerkUserId);
        const primaryEmailObj = clerkUser.emailAddresses.find(
            (e) => e.id === clerkUser.primaryEmailAddressId
        );

        const primaryEmail = primaryEmailObj?.emailAddress;
        if (!primaryEmail) {
            return res.status(400).json({ error: "No primary email found for Clerk user" });
        }

        const email = normalizeEmail(primaryEmail);

        let user = await User.findOne({ primaryEmail: email });
        if (!user) {
            user = await User.create({
                primaryEmail: email,
                name: clerkUser.firstName ?? email.split("@")[0],
                plan: "free",
                onboardingCompleted: false,
                connectedInboxes: [],
            });
        }

        req.userId = user._id.toString();
        return next;
    } catch (err) {
        return next(err);
    }
}