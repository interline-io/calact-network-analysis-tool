// Output processing and report generation over scenario results: the report
// table column/CSV transforms, the route timetable (debug modal) builder, and
// the buffer-details drill-down payload. All pure and consumed by the report
// UI — none of it is part of the fetch/filter pipeline.
export * from './tables'
export * from './timetable'
export * from './buffer-details'
