LET $u = SELECT VALUE id FROM ONLY user WHERE lapseData.id = $lapseData.id;

IF $u {
	UPDATE $u SET lapseData = $lapseData;
	$u;
} ELSE {
	CREATE ONLY user CONTENT {
		lapseData: $lapseData
	} RETURN VALUE id;
};
