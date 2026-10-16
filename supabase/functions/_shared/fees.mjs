export function validFeeSession(session, row) {
 return session.payment_status === 'paid' && session.mode === 'payment' &&
 session.amount_total === 400 && session.currency === 'usd' &&
 session.id === row.stripe_session_id && session.metadata?.app === 'servcycl' &&
 session.metadata?.purpose === 'eatery_shift_fee' &&
 session.metadata?.request_id === row.request_id && session.metadata?.owner_id === row.owner_id;
}
export function canCharge(request, ownerId) {
 return ['accepted', 'completed'].includes(request?.status) && request.shifts?.eateries?.owner_id === ownerId;
}
