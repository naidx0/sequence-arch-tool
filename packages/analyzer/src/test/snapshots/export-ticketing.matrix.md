| from \ to | gateway | worker | api | postgres | topic:ticket.created |
| --- | --- | --- | --- | --- | --- |
| gateway |  |  | http |  |  |
| worker |  |  |  |  | queue_consume |
| api |  |  |  | db_access | queue_publish |
| postgres |  |  |  |  |  |
| topic:ticket.created |  |  |  |  |  |
