governor
========


Startup:
1. check all cli args
2. validate args
3. create/setup socket.io server
4. register priority with local server
6. create cluster connections
7. identify the local server connection
8. broadcast it's new node name, it's priority, it's current process uptime, and whether it's a master or not
9. each node should wait 10 seconds before voting on which node should be master
10. broadcast vote
11. elected node becomes master