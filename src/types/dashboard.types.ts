export interface DashboardResponse {
    counts: {
        total: number;
        active: number;
        offers: number;
        rejected: number;
        interviews: number;
        oas: number;
    };
    upcoming: Array<{
        id: string;
        type: "OA" | "INTERVIEW" | "DEADLINE" | "OTHER";
        title: string;
        startAt: string;
        endAt?: string;
        duration?: number;
        applicationId?: string;
        company?: string;
        role?: string;
    }>;
    graph: Array<{
        date: string;
        appliedCount: number;
        oaCount: number;
        interviewCount: number;
        offerCount: number;
        rejectionCount: number;
    }>;
    calendarMonth: {
        month: string;
        days: Array<{
            date: string;
            count: number;
            types: Record<string, number>;
        }>;
    };
    today: {
        date: string;
        items: DashboardResponse["upcoming"];
    };
    /** Number of connected inboxes (status === "connected"). Used to show connect-inbox prompt when 0. */
    connectedInboxCount: number;
}