LET $now = time::now();
LET $s = SELECT id, expires FROM ONLY $sess;
LET $u = (SELECT
    id,
	lapseData
FROM $sess<-hasSession<-user)[0];

IF $s {
	IF $s.expires < $now {
		DELETE $s;
	} ELSE IF $s.expires < $now + 15d {
		UPDATE $sess SET expires = $now + 30d;
	};
};

{
	session: IF $s {
		IF $s.expires >= $now { record::id($s.id) } ELSE { NONE }
	} ELSE { NONE },
	user: IF $s {
		IF $s.expires >= $now { $u } ELSE { NONE }
	} ELSE { NONE },
	renewed: IF $s {
		IF $s.expires < $now {
			false
		} ELSE {
			$s.expires < $now + 15d
		}
	} ELSE { false },
};
