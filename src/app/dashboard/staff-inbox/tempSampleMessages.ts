/**
 * ⚠️ TEMPORARY SAMPLE DATA — UI LAYOUT PREVIEW ONLY.
 *
 * These messages are NOT real records: nothing here comes from PostgreSQL,
 * no API reads or writes them, and the Staff Inbox page does not claim
 * otherwise (the page shows an explicit "UI preview" notice).
 *
 * They exist only so the frontend layout (list, badges, unread states,
 * detail panel, filters) can be reviewed before any backend work.
 *
 * When the backend step lands, this file is DELETED and the page switches
 * to fetching real messages through an API route — no other module
 * imports this file, so the removal is safe and isolated.
 */

export type TempStaffMessage = {
  id: string;
  senderName: string;
  senderRole: string;
  subject: string;
  body: string;
  /** Where the message lives for the filter tabs. */
  folder: "inbox" | "sent" | "archived";
  read: boolean;
  important: boolean;
  priority: "urgent" | "high" | "normal";
  category: string;
  /** Local timestamp (no Z suffix -> renders in the viewer's own timezone). */
  at: string;
};

export const TEMP_SAMPLE_MESSAGES: TempStaffMessage[] = [
  {
    id: "tmp-msg-01",
    senderName: "Dr. Sana Iqbal",
    senderRole: "Dermatologist",
    subject: "Urgent: reaction on Room 3 patient",
    body:
      "The patient in Room 3 developed redness after the peel this morning. I have applied a soothing gel and she is stable now. Please keep her file flagged and let me know before any further session is booked for her.",
    folder: "inbox",
    read: false,
    important: true,
    priority: "urgent",
    category: "Clinical",
    at: "2026-10-10T09:15:00",
  },
  {
    id: "tmp-msg-02",
    senderName: "Hina Shah",
    senderRole: "Front Desk",
    subject: "Walk-in at 4 PM — Dr. Ayesha slot",
    body:
      "A walk-in wants a consultation with Dr. Ayesha at 4 PM today. The slot is currently free, but it overlaps with the laser appointment. Shall I confirm it or offer 5:30 PM instead?",
    folder: "inbox",
    read: false,
    important: false,
    priority: "normal",
    category: "Scheduling",
    at: "2026-10-10T08:40:00",
  },
  {
    id: "tmp-msg-03",
    senderName: "Bilal Ahmed",
    senderRole: "Store Manager",
    subject: "Low stock: botulinum toxin vials",
    body:
      "We are down to four vials of botulinum toxin. The supplier needs at least three working days for the next order, so please approve the reorder today to avoid running out during the weekend clinic.",
    folder: "inbox",
    read: false,
    important: true,
    priority: "high",
    category: "Inventory",
    at: "2026-10-09T16:20:00",
  },
  {
    id: "tmp-msg-04",
    senderName: "Usman Raza",
    senderRole: "Billing",
    subject: "Pending invoices for October",
    body:
      "Seven invoices from the first week of October are still unpaid. I have attached the list to the shared drive. Two of them are over 30 days old and may need a reminder call from the front desk.",
    folder: "inbox",
    read: true,
    important: false,
    priority: "high",
    category: "Billing",
    at: "2026-10-09T11:05:00",
  },
  {
    id: "tmp-msg-05",
    senderName: "Ayesha Noor",
    senderRole: "Head Nurse",
    subject: "Sterilizer maintenance completed",
    body:
      "The autoclave service technician finished the quarterly maintenance. All instruments passed the pressure test and the certificate is filed in the admin cabinet. The unit is back in service from today.",
    folder: "inbox",
    read: true,
    important: false,
    priority: "normal",
    category: "Admin",
    at: "2026-10-08T14:30:00",
  },
  {
    id: "tmp-msg-06",
    senderName: "You",
    senderRole: "Clinic Admin",
    subject: "Shift roster for next week",
    body:
      "Please check the published roster for next week. Friday needs one extra nurse for the evening clinic — volunteers can reply to this thread by Wednesday so I can lock the schedule.",
    folder: "sent",
    read: true,
    important: false,
    priority: "normal",
    category: "Staff",
    at: "2026-10-09T18:10:00",
  },
  {
    id: "tmp-msg-07",
    senderName: "You",
    senderRole: "Clinic Admin",
    subject: "Reminder: monthly training this Friday",
    body:
      "Our monthly infection-control training is scheduled for Friday after closing. Attendance is mandatory for clinical staff; the session takes about 45 minutes and covers the updated sterilization checklist.",
    folder: "sent",
    read: true,
    important: true,
    priority: "normal",
    category: "Staff",
    at: "2026-10-08T10:00:00",
  },
  {
    id: "tmp-msg-08",
    senderName: "You",
    senderRole: "Clinic Admin",
    subject: "Updated SOP for laser rooms",
    body:
      "The laser-room standard operating procedure has been updated after the safety audit. Read it before your next laser session and sign the acknowledgment sheet at the front desk.",
    folder: "sent",
    read: true,
    important: false,
    priority: "normal",
    category: "Admin",
    at: "2026-10-07T13:45:00",
  },
  {
    id: "tmp-msg-09",
    senderName: "Nadia Khan",
    senderRole: "Reception",
    subject: "Old maintenance logs — September",
    body:
      "September maintenance logs have been scanned and stored. Nothing needs action; keeping this thread here for the yearly inspection file.",
    folder: "archived",
    read: true,
    important: false,
    priority: "normal",
    category: "Admin",
    at: "2026-09-30T17:00:00",
  },
  {
    id: "tmp-msg-10",
    senderName: "Dr. Hamza Sheikh",
    senderRole: "Dermatologist",
    subject: "Conference leave application (resolved)",
    body:
      "My leave for the dermatology conference has been approved and the schedule was covered. Thank you for arranging the locum — this thread can be archived.",
    folder: "archived",
    read: true,
    important: false,
    priority: "normal",
    category: "Staff",
    at: "2026-09-28T09:30:00",
  },
];
