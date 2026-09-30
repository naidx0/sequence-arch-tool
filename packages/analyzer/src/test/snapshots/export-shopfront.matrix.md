| from \ to | edge | inventory | notifications | gateway | invoices | orders | payments | postgres | shipping | topic:order.created |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| edge |  |  |  | http |  |  |  |  |  |  |
| inventory |  |  |  |  |  |  |  |  |  |  |
| notifications |  |  |  |  |  |  |  |  |  | queue_consume |
| gateway |  |  |  |  | http | http | http |  | http |  |
| invoices |  |  |  |  |  |  | http | db_access |  |  |
| orders |  | grpc |  |  |  |  | http | db_access |  | queue_publish |
| payments |  |  |  |  |  |  |  | db_access |  |  |
| postgres |  |  |  |  |  |  |  |  |  |  |
| shipping |  |  |  |  |  |  |  | db_access |  | queue_consume |
| topic:order.created |  |  |  |  |  |  |  |  |  |  |
