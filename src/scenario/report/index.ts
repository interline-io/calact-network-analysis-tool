// Output processing and report generation over scenario results: the report
// table column/CSV transforms, the trip listing behind the trip panel and
// table, transfers at a stop or cluster, and the buffer-details drill-down
// payload. All pure and consumed by the report UI — none of it is part of the
// fetch/filter pipeline.
export * from './tables'
export * from './buffer-details'
export * from './subject-trips'
export * from './transfers'
