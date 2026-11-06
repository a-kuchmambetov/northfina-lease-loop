// GET /api/invoices/:id/pdf?locale=en|fi|sv|et&disposition=inline — the signed-in customer
// downloads one of their own issued or paid invoices as a PDF, or with `disposition=inline`
// gets it to show in the page (the preview). Unlike every other route this answers with a
// file, not the JSON envelope; errors still use it.
import { loadCustomers } from '@/data/load';
import { applicantCustomerId } from '@/domain/catalogue';
import { getT } from '@/i18n/get-t';
import { defaultLocale, isLocale } from '@/i18n/locales';
import { fail, handleRoute } from '@/server/api-response';
import { pdfDisposition, pdfResponse } from '@/server/pdf-response';
import { getAuth } from '@/server/auth-instance';
import { db } from '@/server/db';
import { getInvoiceDocument } from '@/server/features/contracts/get-invoice-document';
import { findCustomerForUser } from '@/server/features/customers/find-customer-for-user';
import { renderInvoicePdf } from '@/server/invoice-pdf';
import { todayIso } from '@/server/today';

export const GET = handleRoute(
  async (request, { params }: RouteContext<'/api/invoices/[id]/pdf'>) => {
    const session = await getAuth().api.getSession({
      headers: request.headers,
      query: { disableRefresh: true },
    });
    if (!session) return fail(401, 'UNAUTHORIZED', 'Sign in required');
    if (session.user.accountType !== 'customer')
      return fail(403, 'FORBIDDEN', 'Customer account required');

    const profile = await findCustomerForUser(db, session.user.id);
    const customerId = profile?.id ?? applicantCustomerId(await loadCustomers());
    if (!customerId) return fail(404, 'UNKNOWN_INVOICE', 'The invoice could not be found');

    const requested = new URL(request.url).searchParams.get('locale');
    const locale = requested !== null && isLocale(requested) ? requested : defaultLocale;

    const { id } = await params;
    const result = await getInvoiceDocument(db, {
      invoiceId: id,
      customerId,
      today: todayIso(),
    });
    if (!result.ok) {
      const status = result.reason === 'unknown_invoice' ? 404 : 422;
      return fail(status, result.reason.toUpperCase(), 'The invoice could not be created');
    }

    const bytes = await renderInvoicePdf(result.document, getT(locale), locale);
    return pdfResponse(
      bytes,
      `invoice-${result.document.number}.pdf`,
      pdfDisposition(new URL(request.url).searchParams.get('disposition'))
    );
  }
);
